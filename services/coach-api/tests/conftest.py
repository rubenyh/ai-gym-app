"""Deterministic fakes: scripted model provider and in-memory user-scoped data client. No network."""

from __future__ import annotations

import asyncio
import copy
import json
import uuid
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from coach_api.catalog import load_catalog
from coach_api.config import Settings
from coach_api.data import AuthError
from coach_api.main import create_app

CATALOG = load_catalog(Path(__file__).parent / "fixtures" / "catalog.json")
TOKEN = "test-token"
PROGRAM_ID = "11111111-1111-4111-8111-111111111111"


def new_id() -> str:
    return str(uuid.uuid4())


BASE_SETTINGS = Settings(
    supabase_url=None, supabase_anon_key=None, provider="scripted", gemini_api_key=None, gemini_model=None,
    timeout_seconds=5, max_repairs=1, max_output_tokens=1000, max_context_chars=12000, max_candidates=120,
    user_requests_per_hour=100, daily_request_cap=1000, catalog_path=Path("unused"),
)


class ScriptedProvider:
    """Test-only provider. Each queue item is JSON text, a dict (dumped), an Exception, or ('sleep', s)."""

    name = "scripted-test"

    def __init__(self, interpret=None, generate=None):
        self.queues = {"interpret": list(interpret or []), "generate": list(generate or [])}
        self.calls: list[tuple[str, str, str]] = []

    async def complete(self, task, system, prompt, schema):
        self.calls.append((task, system, prompt))
        queue = self.queues[task]
        item = queue.pop(0) if queue else ("{}" if task == "interpret" else "")
        if isinstance(item, Exception):
            raise item
        if isinstance(item, tuple):
            await asyncio.sleep(item[1])
            return "{}"
        return item if isinstance(item, str) else json.dumps(item)

    def count(self, task):
        return sum(1 for c in self.calls if c[0] == task)


class FakeData:
    """Mirrors the RPC surface (coach_get_context/begin/save/cancel/get). Records calls."""

    def __init__(self, profile, active_program=None, recent_sessions=None):
        self.context = {
            "trainingProfile": profile,
            "activeProgram": active_program,
            "routines": [],
            "recentSessions": recent_sessions or [],
        }
        self.drafts: dict[str, dict] = {}
        self.by_request: dict[str, str] = {}
        self.calls: list[str] = []

    async def get_context(self):
        self.calls.append("get_context")
        return copy.deepcopy(self.context)

    async def begin_request(self, request_id, mode, program_id, base_revision, input):
        self.calls.append("begin_request")
        if request_id in self.by_request:
            return {**self.drafts[self.by_request[request_id]], "created": False}
        draft_id = new_id()
        self.by_request[request_id] = draft_id
        self.drafts[draft_id] = {
            "draftId": draft_id, "requestId": request_id, "status": "pending",
            "baseProgramId": program_id, "baseProgramRevision": base_revision,
            "draft": None, "clarification": None, "error": None,
        }
        return {**self.drafts[draft_id], "created": True}

    async def save_draft(self, draft_id, status, content, clarification, error, model):
        self.calls.append("save_draft")
        self.drafts[draft_id].update(status=status, draft=content, clarification=clarification, error=error, model=model)
        return self.drafts[draft_id]

    async def cancel_draft(self, draft_id):
        self.calls.append("cancel_draft")
        self.drafts[draft_id]["status"] = "cancelled"
        return self.drafts[draft_id]

    async def get_draft(self, draft_id):
        self.calls.append("get_draft")
        return self.drafts.get(draft_id)


def profile(**overrides):
    base = {
        "goal": "general fitness", "age": 30, "heightCm": 175, "experience": "beginner",
        "equipment": [], "limitations": None, "availableWeekdays": [1, 3, 5], "sessionMinutes": 60,
    }
    return {**base, **overrides}


def ex(key, sets=3, reps=(8, 12), rest=90, **extra):
    return {"exerciseKey": key, "exerciseName": "model-supplied name", "sets": sets,
            "repsMin": reps[0], "repsMax": reps[1], "restSeconds": rest, **extra}


def draft(days, **extra):
    """days: {weekday: [exercise dicts]}"""
    return {
        "title": "Coach plan", "explanation": "Balanced plan.", "assumptions": [],
        "days": [{"weekday": w, "routineName": f"Day {w}", "exercises": exs} for w, exs in days.items()],
        **extra,
    }


async def _verify(token):
    if token != TOKEN:
        raise AuthError("bad")
    return "user-1"


class Harness:
    def __init__(self, data: FakeData, provider, settings=BASE_SETTINGS):
        self.data, self.provider = data, provider
        self.client = TestClient(create_app(settings=settings, provider=provider, catalog=CATALOG,
                                            verify=_verify, data_factory=lambda token: data))

    def post(self, text="Build me a plan", request_id=None, mode="create", program_id=None, base_revision=None):
        body = {"requestId": request_id or new_id(), "mode": mode, "programId": program_id,
                "baseRevision": base_revision, "preferencesText": text}
        return self.client.post("/v1/coach/drafts", json=body, headers={"Authorization": f"Bearer {TOKEN}"})


@pytest.fixture
def harness():
    def make(data=None, interpret=None, generate=None, settings=BASE_SETTINGS, **settings_overrides):
        provider = ScriptedProvider(interpret, generate)
        if settings_overrides:
            settings = replace(settings, **settings_overrides)
        return Harness(data or FakeData(profile()), provider, settings)
    return make
