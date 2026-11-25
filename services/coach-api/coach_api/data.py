"""Supabase access with the USER's token (RLS applies). No service-role key, no plan-modifying calls.

The graph can only: read authorized context, begin/save/cancel/read its own coach drafts.
"""

from __future__ import annotations

from typing import Any, Protocol

import httpx


class AuthError(Exception):
    pass


class DataError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


class CoachData(Protocol):
    async def get_context(self) -> dict: ...
    async def begin_request(self, request_id: str, mode: str, program_id: str | None,
                            base_revision: int | None, input: dict, hourly_limit: int, daily_cap: int) -> dict: ...
    async def save_draft(self, draft_id: str, status: str, content: dict | None, clarification: dict | None,
                         error: dict | None, model: str) -> dict: ...
    async def cancel_draft(self, draft_id: str) -> dict: ...
    async def get_draft(self, draft_id: str) -> dict | None: ...


async def verify_user(http: httpx.AsyncClient, supabase_url: str, anon_key: str, token: str) -> str:
    """Supabase Auth validates signature, issuer and expiry server-side; we also require aud=authenticated."""
    try:
        r = await http.get(
            f"{supabase_url}/auth/v1/user",
            headers={"apikey": anon_key, "Authorization": f"Bearer {token}"},
        )
    except httpx.HTTPError as e:
        raise DataError(503, "auth_unreachable", "Could not reach Supabase Auth.") from e
    if r.status_code != 200:
        raise AuthError("invalid token")
    user = r.json()
    if user.get("aud") != "authenticated" or not user.get("id"):
        raise AuthError("invalid audience")
    return user["id"]


class SupabaseData:
    def __init__(self, http: httpx.AsyncClient, supabase_url: str, anon_key: str, token: str):
        self._http = http
        self._base = f"{supabase_url}/rest/v1"
        self._headers = {"apikey": anon_key, "Authorization": f"Bearer {token}"}

    async def _rpc(self, name: str, args: dict[str, Any]) -> Any:
        try:
            r = await self._http.post(f"{self._base}/rpc/{name}", json=args, headers=self._headers)
        except httpx.HTTPError as e:
            raise DataError(503, "data_unreachable", "Could not reach the database.") from e
        if r.status_code >= 400:
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            # PT429 -> HTTP 429 (rate_limited | budget_exhausted), P0002 -> 404. Never echo the request payload.
            code = {429: "rate_limited", 404: "not_found"}.get(r.status_code, "data_error")
            if code == "rate_limited" and body.get("message") == "budget_exhausted":
                code = "budget_exhausted"
            message = {
                "rate_limited": "Too many coach requests. Try again later.",
                "budget_exhausted": "The coach has reached today's request budget. Try again tomorrow.",
                "not_found": "Not found.",
            }.get(code, str(body.get("message", "Database error.")))
            raise DataError(r.status_code, code, message)
        return r.json()

    async def get_context(self) -> dict:
        return await self._rpc("coach_get_context", {})

    async def begin_request(self, request_id, mode, program_id, base_revision, input, hourly_limit, daily_cap) -> dict:
        """RPC returns {created, draft: CoachDraftResponse}; flattened to {...draft, created}.

        Both limits are enforced atomically in the database (20261125200000_coach_hardening.sql), so they hold
        across service processes. The database only lets the hourly limit be lowered (max 10/hour).
        """
        r = await self._rpc("coach_begin_request", {
            "p_request_id": request_id, "p_mode": mode, "p_program_id": program_id,
            "p_base_revision": base_revision, "p_input": input,
            "p_hourly_limit": hourly_limit, "p_daily_cap": daily_cap,
        })
        return {**r["draft"], "created": r["created"]}

    async def save_draft(self, draft_id, status, content, clarification, error, model) -> dict:
        return await self._rpc("coach_save_draft", {
            "p_draft_id": draft_id, "p_status": status, "p_content": content,
            "p_clarification": clarification, "p_error": error, "p_model": model,
        })

    async def cancel_draft(self, draft_id) -> dict:
        return await self._rpc("coach_cancel_draft", {"p_draft_id": draft_id})

    async def get_draft(self, draft_id) -> dict | None:
        """Owner-read via RLS on public.coach_drafts (no RPC needed)."""
        try:
            r = await self._http.get(f"{self._base}/coach_drafts", headers=self._headers, params={
                "id": f"eq.{draft_id}",
                "select": "id,request_id,status,base_program_id,base_program_revision,content,clarification,error",
            })
        except httpx.HTTPError as e:
            raise DataError(503, "data_unreachable", "Could not reach the database.") from e
        if r.status_code >= 400:
            raise DataError(r.status_code, "data_error", "Database error.")
        rows = r.json()
        if not rows:
            return None
        d = rows[0]
        return {"draftId": d["id"], "requestId": d["request_id"], "status": d["status"],
                "baseProgramId": d["base_program_id"], "baseProgramRevision": d["base_program_revision"],
                "draft": d["content"], "clarification": d["clarification"], "error": d["error"]}
