"""FastAPI entry point: POST/GET /v1/coach/drafts, cancel, /health."""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .catalog import Exercise, load_catalog
from .config import Settings
from .data import AuthError, CoachData, DataError, SupabaseData, verify_user
from .graph import Deps, run
from .models import CoachDraftRequest, CoachDraftResponse, is_uuid
from .providers import ModelProvider, ProviderError, provider_from_settings

log = logging.getLogger("coach_api")

VerifyFn = Callable[[str], Awaitable[str]]
DataFactory = Callable[[str], CoachData]


def _error(status: int, code: str, message: str, retryable: bool) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message, "retryable": retryable})


def _failure(exc: Exception) -> dict:
    if isinstance(exc, ProviderError):
        return {"code": exc.code, "message": exc.message, "retryable": exc.retryable}
    if isinstance(exc, TimeoutError):
        return {"code": "timeout", "message": "The coach took too long. Try again.", "retryable": True}
    code = "data_unavailable" if isinstance(exc, DataError) else "provider_error"
    return {"code": code, "message": "The coach is temporarily unavailable. Try again.", "retryable": True}


def create_app(
    settings: Settings | None = None,
    provider: ModelProvider | None = None,
    catalog: dict[str, Exercise] | None = None,
    verify: VerifyFn | None = None,
    data_factory: DataFactory | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    provider = provider or provider_from_settings(settings)
    if catalog is None:
        catalog = load_catalog(settings.catalog_path) if settings.catalog_path.exists() else {}
    http = httpx.AsyncClient(timeout=10)

    if verify is None:
        async def verify(token: str) -> str:
            if not settings.supabase_url or not settings.supabase_anon_key:
                raise _error(503, "coach_unavailable", "Coach service is missing SUPABASE_URL/SUPABASE_ANON_KEY.", False)
            return await verify_user(http, settings.supabase_url, settings.supabase_anon_key, token)

    if data_factory is None:
        def data_factory(token: str) -> CoachData:
            return SupabaseData(http, settings.supabase_url or "", settings.supabase_anon_key or "", token)

    app = FastAPI(title="AI Gym coach API")
    if settings.cors_origins:
        # Bearer tokens only, no cookies: credentials stay off.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["GET", "POST"],
            allow_headers=["Authorization", "Content-Type"],
        )

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        body = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail), "retryable": False}
        return JSONResponse(body, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError):
        # Field paths only; never echo the submitted payload.
        fields = [".".join(str(p) for p in e["loc"]) for e in exc.errors()]
        return JSONResponse({"code": "invalid_request", "message": f"Invalid fields: {fields}", "retryable": False}, 422)

    @app.exception_handler(DataError)
    async def data_error(_: Request, exc: DataError):
        return JSONResponse({"code": exc.code, "message": exc.message, "retryable": exc.status >= 429}, exc.status)

    async def auth(authorization: str = Header(default="")) -> tuple[str, CoachData]:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise _error(401, "unauthorized", "Missing bearer token.", False)
        try:
            user_id = await verify(token)
        except AuthError:
            raise _error(401, "unauthorized", "Invalid or expired session. Sign in again.", False) from None
        return user_id, data_factory(token)

    def respond(state: dict) -> dict:
        return CoachDraftResponse.model_validate(state).model_dump(by_alias=True)

    @app.get("/health")
    async def health():
        return {"status": "ok", "providerConfigured": provider is not None, "catalogSize": len(catalog)}

    @app.post("/v1/coach/drafts")
    async def create_draft(body: CoachDraftRequest, who=Depends(auth)):
        _, data = who
        if provider is None:
            raise _error(503, "coach_unavailable",
                         "The coach is not configured on the server (COACH_PROVIDER/GEMINI_API_KEY/GEMINI_MODEL).", True)
        if not catalog:
            raise _error(503, "coach_unavailable", "The exercise catalog is not available on the server.", True)
        # One budget for the whole request: begin + context + both model calls + persist. A small reserve is kept
        # so a failure can still be recorded; past it, the DB expires the pending draft (5 min) on retry.
        loop = asyncio.get_running_loop()
        deadline = loop.time() + settings.timeout_seconds
        work_deadline = deadline - min(5.0, settings.timeout_seconds * 0.1)
        try:
            async with asyncio.timeout_at(work_deadline):
                state = await data.begin_request(
                    body.request_id, body.mode, body.program_id, body.base_revision,
                    {"mode": body.mode, "preferencesText": body.preferences_text},
                    settings.user_requests_per_hour, settings.daily_request_cap,
                )
        except TimeoutError:
            raise _error(504, "timeout", "The coach took too long. Try again.", True) from None
        if not state.get("created"):
            return respond(state)  # duplicate request ID (also concurrent): existing state, no new model call

        draft_id = state["draftId"]
        deps = Deps(data=data, provider=provider, catalog=catalog, settings=settings)
        try:
            async with asyncio.timeout_at(work_deadline):
                saved = await run(deps, body, draft_id)
            log.info("coach draft", extra={"draft_id": draft_id, "status": saved["status"]})
            return respond(saved)
        except Exception as exc:  # timeout, provider or network failure: plans stay untouched
            error = _failure(exc)
            log.warning("coach run failed", extra={"draft_id": draft_id, "code": error["code"],
                                                   "exc_type": type(exc).__name__})
        try:
            async with asyncio.timeout_at(deadline):
                # Returns the stored draft unchanged if it is no longer pending (cancelled or already saved).
                saved = await data.save_draft(draft_id, "failed", None, None, error, provider.name)
        except Exception as exc:
            log.warning("could not record failure", extra={"draft_id": draft_id, "exc_type": type(exc).__name__})
            saved = {**state, "status": "failed", "error": error}
        return respond(saved)

    def require_uuid(draft_id: str) -> str:
        if not is_uuid(draft_id):
            raise _error(404, "not_found", "Draft not found.", False)
        return draft_id

    @app.get("/v1/coach/drafts/{draft_id}")
    async def get_draft(draft_id: str = Depends(require_uuid), who=Depends(auth)):
        state = await who[1].get_draft(draft_id)
        if not state:
            raise _error(404, "not_found", "Draft not found.", False)
        return respond(state)

    @app.post("/v1/coach/drafts/{draft_id}/cancel")
    async def cancel_draft(draft_id: str = Depends(require_uuid), who=Depends(auth)):
        return respond(await who[1].cancel_draft(draft_id))

    return app


def app_factory() -> FastAPI:
    return create_app()
