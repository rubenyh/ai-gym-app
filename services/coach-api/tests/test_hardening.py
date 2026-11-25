"""Gemini adapter (real code path, fake google-genai client), request budget, concurrency and cancellation."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from google.genai import errors, types

from coach_api.models import DraftContent, Intent
from coach_api.providers import GeminiProvider

from conftest import BASE_SETTINGS, TOKEN, FakeData, Harness, ScriptedProvider, draft, ex, new_id, profile

PLAN = draft({1: [ex("catalog:0001"), ex("catalog:0002")], 3: [ex("catalog:0003"), ex("catalog:0004")]})
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def ok(payload) -> types.GenerateContentResponse:
    return types.GenerateContentResponse(candidates=[types.Candidate(
        content=types.Content(role="model", parts=[types.Part(text=json.dumps(payload))]),
        finish_reason=types.FinishReason.STOP)])


class FakeModels:
    """Stands in for client.aio.models; each queued item is a response or an exception."""

    def __init__(self, *items):
        self.items, self.calls = list(items), []

    async def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        item = self.items.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


def gemini(*items) -> tuple[GeminiProvider, FakeModels]:
    models = FakeModels(*items)
    return GeminiProvider("unused", "configured-model", 1234, client=SimpleNamespace(aio=SimpleNamespace(models=models))), models


def body(rid=None, text="Build me a plan"):
    return {"requestId": rid or new_id(), "mode": "create", "programId": None, "baseRevision": None, "preferencesText": text}


# ------------------------------------------------------------------ Gemini adapter


def test_gemini_adapter_structured_output_end_to_end():
    provider, models = gemini(ok({}), ok(PLAN))
    h = Harness(FakeData(profile()), provider)
    r = h.client.post("/v1/coach/drafts", json=body(), headers=AUTH).json()
    assert r["status"] == "ready" and provider.name == "gemini:configured-model"
    interpret, generate = models.calls
    for call, schema in ((interpret, Intent), (generate, DraftContent)):
        cfg = call["config"]
        assert call["model"] == "configured-model" and cfg.max_output_tokens == 1234
        assert cfg.response_mime_type == "application/json" and cfg.tools is None
        assert cfg.response_json_schema == schema.model_json_schema(by_alias=True)
        assert "untrusted" in cfg.system_instruction
    gen_schema = generate["config"].response_json_schema
    assert gen_schema["additionalProperties"] is False and "days" in gen_schema["properties"]
    assert "exerciseKey" in gen_schema["$defs"]["DraftExercise"]["properties"]  # camelCase like the validator


def _api_error(cls, code):
    return cls(code, {"error": {"code": code, "message": "upstream detail", "status": "X"}})


@pytest.mark.parametrize("item,code,retryable", [
    (_api_error(errors.ClientError, 429), "quota_exceeded", True),
    (_api_error(errors.ServerError, 503), "provider_unavailable", True),
    (_api_error(errors.ServerError, 504), "provider_timeout", True),
    (_api_error(errors.ClientError, 400), "provider_error", False),
    (httpx.ReadTimeout("slow"), "provider_timeout", True),
    (httpx.ConnectError("down"), "provider_unavailable", True),
    (types.GenerateContentResponse(prompt_feedback=types.GenerateContentResponsePromptFeedback(
        block_reason=types.BlockedReason.SAFETY)), "safety_blocked", True),
    (types.GenerateContentResponse(candidates=[types.Candidate(finish_reason=types.FinishReason.SAFETY)]),
     "safety_blocked", True),
    (types.GenerateContentResponse(candidates=[]), "empty_response", True),
    (types.GenerateContentResponse(candidates=[types.Candidate(
        content=types.Content(role="model", parts=[types.Part(text="  ")]), finish_reason=types.FinishReason.STOP)]),
     "empty_response", True),
])
def test_gemini_failures_are_recoverable_and_leak_nothing(item, code, retryable):
    provider, models = gemini(item)
    data = FakeData(profile())
    h = Harness(data, provider)
    r = h.client.post("/v1/coach/drafts", json=body(), headers=AUTH)
    out = r.json()
    assert r.status_code == 200 and out["status"] == "failed"
    assert out["error"]["code"] == code and out["error"]["retryable"] is retryable
    assert "upstream detail" not in r.text and len(models.calls) == 1  # no retry loop, no repair on provider errors
    assert data.drafts[out["draftId"]]["status"] == "failed"
    assert set(data.calls) <= {"begin_request", "get_context", "save_draft"}  # nothing touches plans


# ------------------------------------------------------------------ one budget for DB + model calls


class SlowData(FakeData):
    def __init__(self, slow: str, seconds: float):
        super().__init__(profile())
        self.slow, self.seconds = slow, seconds

    async def begin_request(self, *a):
        if self.slow == "begin_request":
            await asyncio.sleep(self.seconds)
        return await super().begin_request(*a)

    async def get_context(self):
        if self.slow == "get_context":
            await asyncio.sleep(self.seconds)
        return await super().get_context()


def test_budget_covers_database_calls():
    for slow, status in (("get_context", 200), ("begin_request", 504)):
        data = SlowData(slow, 5)
        h = Harness(data, ScriptedProvider(generate=[PLAN]), replace(BASE_SETTINGS, timeout_seconds=0.5))
        started = time.monotonic()
        r = h.client.post("/v1/coach/drafts", json=body(), headers=AUTH)
        assert time.monotonic() - started < 2
        out = r.json()
        assert r.status_code == status and (out.get("error") or out)["retryable"] is True
        if status == 200:
            assert out["status"] == "failed" and out["error"]["code"] == "timeout"
            assert data.drafts[out["draftId"]]["status"] == "failed"
        assert h.provider.calls == []


# ------------------------------------------------------------------ concurrency and cancellation


def _asgi(h: Harness):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=h.client.app), base_url="http://t")


def test_concurrent_duplicate_request_runs_model_once():
    h = Harness(FakeData(profile()), ScriptedProvider(interpret=[("sleep", 0.3)], generate=[PLAN]))

    async def go():
        async with _asgi(h) as api:
            b = body()
            return await asyncio.gather(*(api.post("/v1/coach/drafts", json=b, headers=AUTH) for _ in range(2)))

    a, b = asyncio.run(go())
    assert a.json()["draftId"] == b.json()["draftId"]
    assert sorted([a.json()["status"], b.json()["status"]]) == ["pending", "ready"]
    assert len(h.data.drafts) == 1 and h.provider.count("interpret") == 1 and h.provider.count("generate") == 1


def test_cancel_while_generating_is_not_flipped_by_late_result():
    h = Harness(FakeData(profile()), ScriptedProvider(interpret=[("sleep", 0.3)], generate=[PLAN]))

    async def go():
        async with _asgi(h) as api:
            task = asyncio.create_task(api.post("/v1/coach/drafts", json=body(), headers=AUTH))
            await asyncio.sleep(0.1)
            (draft_id,) = h.data.drafts
            assert (await api.post(f"/v1/coach/drafts/{draft_id}/cancel", headers=AUTH)).json()["status"] == "cancelled"
            return draft_id, await task

    draft_id, late = asyncio.run(go())
    assert late.json()["status"] == "cancelled" and late.json()["draft"] is None
    assert h.data.drafts[draft_id]["status"] == "cancelled"
