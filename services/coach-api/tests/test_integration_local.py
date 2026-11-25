"""Integration against the LOCAL Supabase stack (real auth, RPCs, RLS); the model is scripted.

Skipped unless SUPABASE_URL (or API_URL), SUPABASE_ANON_KEY (or ANON_KEY) and SERVICE_ROLE_KEY are set and the
URL is local. SERVICE_ROLE_KEY is used only here, only to create confirmed test users. Never resets the database.
"""

from __future__ import annotations

import os
import re
import time
import uuid
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient

from coach_api.catalog import load_catalog
from coach_api.config import DEFAULT_CATALOG
from coach_api.main import create_app

from conftest import BASE_SETTINGS, ScriptedProvider, draft, ex

URL = os.environ.get("SUPABASE_URL") or os.environ.get("API_URL")
ANON = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("ANON_KEY")
SERVICE = os.environ.get("SERVICE_ROLE_KEY")

pytestmark = pytest.mark.skipif(
    not (URL and ANON and SERVICE and re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?$", URL.rstrip("/"))),
    reason="local Supabase env not set (see README: integration test)",
)

RUN = format(int(time.time() * 1000), "x")


def nid() -> str:
    return str(uuid.uuid4())


class User:
    def __init__(self, http: httpx.Client, label: str):
        email, password = f"coach-{label}-{RUN}@test.local", f"pw-{RUN}-{label}"
        admin = {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"}
        r = http.post(f"{URL}/auth/v1/admin/users", headers=admin,
                      json={"email": email, "password": password, "email_confirm": True})
        r.raise_for_status()
        r = http.post(f"{URL}/auth/v1/token", params={"grant_type": "password"}, headers={"apikey": ANON},
                      json={"email": email, "password": password})
        r.raise_for_status()
        self.token = r.json()["access_token"]
        self.http = http
        self.headers = {"apikey": ANON, "Authorization": f"Bearer {self.token}"}

    def rpc(self, name: str, args: dict):
        r = self.http.post(f"{URL}/rest/v1/rpc/{name}", headers=self.headers, json=args)
        assert r.status_code < 400, (name, r.status_code, r.text)
        return r.json() if r.content else None

    def push(self, aggregate_type: str, aggregate_id: str, doc: dict, base_revision=None) -> dict:
        return self.rpc("sync_push", {"p_op": {"opId": nid(), "aggregateType": aggregate_type, "aggregateId": aggregate_id,
                                               "action": "upsert", "baseRevision": base_revision, "doc": doc}})

    def active(self) -> dict | None:
        return self.rpc("coach_get_context", {})["activeProgram"]


def approval_doc(draft_response: dict, approval_id: str) -> dict:
    """Mirror of app/src/features/coach/approval.ts buildApprovalDoc."""
    content = draft_response["draft"]
    routines = [{
        "id": nid(), "name": d["routineName"], "notes": "", "archived": False, "origin": "coach",
        "exercises": [{
            "id": nid(), "position": i, "exerciseKey": e["exerciseKey"], "exerciseName": e["exerciseName"],
            "notes": "", "restSeconds": e["restSeconds"],
            "sets": [{"id": nid(), "position": s, "targetReps": e["repsMax"], "targetLoadGrams": None,
                      "loadMode": "bodyweight"} for s in range(e["sets"])],
        } for i, e in enumerate(d["exercises"])],
    } for d in content["days"]]
    return {
        "approvalId": approval_id, "draftId": draft_response["draftId"],
        "baseProgramId": draft_response["baseProgramId"], "baseProgramRevision": draft_response["baseProgramRevision"],
        "program": {"id": nid(), "name": content["title"], "active": True, "origin": "coach",
                    "coachDraftId": draft_response["draftId"],
                    "days": [{"weekday": d["weekday"], "routineId": r["id"]} for d, r in zip(content["days"], routines)]},
        "routines": routines,
    }


def test_coach_flow_against_local_supabase():
    catalog = load_catalog(DEFAULT_CATALOG)
    bodyweight = [k for k, e in catalog.items() if e.load_mode == "bodyweight" and e.equipment == ("body weight",)][:4]
    plan = draft({1: [ex(bodyweight[0]), ex(bodyweight[1])], 3: [ex(bodyweight[2]), ex(bodyweight[3])]})
    provider = ScriptedProvider(generate=[plan, plan, "not json", "still not json"])
    settings = replace(BASE_SETTINGS, supabase_url=URL, supabase_anon_key=ANON, timeout_seconds=30)
    app = create_app(settings=settings, provider=provider, catalog=catalog)

    with httpx.Client(timeout=20) as http, TestClient(app) as client:
        a, b = User(http, "a"), User(http, "b")
        a.rpc("complete_onboarding", {"p_handle": f"coach_a_{RUN}"[:30], "p_display_name": "Coach A",
                                      "p_weight_unit": "kg", "p_length_unit": "cm",
                                      "p_timezone": "Europe/Madrid", "p_target_days": 3})
        r = http.post(f"{URL}/rest/v1/training_profiles", headers=a.headers, json={
            "goal": "general fitness", "experience": "beginner", "equipment": [],
            "available_weekdays": [1, 3, 5], "session_minutes": 60})
        assert r.status_code < 400, r.text

        def post(user: User, request_id: str, program_id=None, base_revision=None):
            return client.post("/v1/coach/drafts", headers={"Authorization": f"Bearer {user.token}"}, json={
                "requestId": request_id, "mode": "create", "programId": program_id,
                "baseRevision": base_revision, "preferencesText": "Full body, bodyweight only"})

        # 1. Ready draft persisted; repeat request ID returns it without another model call.
        rid = nid()
        first = post(a, rid).json()
        assert first["status"] == "ready", first
        calls = len(provider.calls)
        again = post(a, rid).json()
        assert again == first and len(provider.calls) == calls
        got = client.get(f"/v1/coach/drafts/{first['draftId']}", headers={"Authorization": f"Bearer {a.token}"})
        assert got.status_code == 200 and got.json()["draft"] == first["draft"]

        # 2. Another user cannot read the draft (RLS).
        other = client.get(f"/v1/coach/drafts/{first['draftId']}", headers={"Authorization": f"Bearer {b.token}"})
        assert other.status_code == 404

        # 3. Approval applies once; a second approval of the same draft is rejected.
        doc = approval_doc(first, nid())
        res = a.push("coach_approval", doc["approvalId"], doc)
        assert res["status"] == "applied", res
        active = a.active()
        assert active and active["id"] == doc["program"]["id"]
        assert a.push("coach_approval", doc["approvalId"], doc)["status"] == "duplicate"
        second = approval_doc(first, nid())
        res = a.push("coach_approval", second["approvalId"], second)
        assert res["status"] == "rejected" and res["code"] == "already_approved", res
        assert a.active()["id"] == doc["program"]["id"]

        # 4. Stale base: draft made against revision N, program changes, approval -> conflict.
        draft2 = post(a, nid(), active["id"], active["revision"]).json()
        assert draft2["status"] == "ready", draft2
        renamed = {**active["doc"], "name": "Renamed"}
        assert a.push("program", active["id"], renamed, active["revision"])["status"] == "applied"
        before = a.active()
        stale = approval_doc(draft2, nid())
        res = a.push("coach_approval", stale["approvalId"], stale)
        assert res["status"] == "conflict", res
        assert a.active() == before

        # 5. Invalid output twice -> failed draft, active program unchanged.
        failed = post(a, nid(), before["id"], before["revision"]).json()
        assert failed["status"] == "failed" and failed["error"]["code"] == "invalid_model_output", failed
        assert a.active() == before

        # 6. Database rate limit (PT429) maps to HTTP 429 rate_limited. B has no profile: each request is cheap.
        statuses = [post(b, nid()) for _ in range(11)]
        assert statuses[-1].status_code == 429, [s.status_code for s in statuses]
        assert statuses[-1].json()["code"] == "rate_limited"
        assert all(s.status_code == 200 for s in statuses[:10])
