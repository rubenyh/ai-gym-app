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
CREATED: list[str] = []


@pytest.fixture(autouse=True)
def delete_test_users():
    """Remove created users (cascades to profiles/drafts/programs) so pgTAP counts stay valid."""
    yield
    admin = {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"}
    with httpx.Client(timeout=20) as http:
        while CREATED:
            http.delete(f"{URL}/auth/v1/admin/users/{CREATED.pop()}", headers=admin)


def nid() -> str:
    return str(uuid.uuid4())


class User:
    def __init__(self, http: httpx.Client, label: str):
        email, password = f"coach-{label}-{RUN}@test.local", f"pw-{RUN}-{label}"
        admin = {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"}
        r = http.post(f"{URL}/auth/v1/admin/users", headers=admin,
                      json={"email": email, "password": password, "email_confirm": True})
        r.raise_for_status()
        self.id = r.json()["id"]
        CREATED.append(self.id)
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


def _profile(http: httpx.Client, user: User, label: str):
    user.rpc("complete_onboarding", {"p_handle": f"coach_{label}_{RUN}"[:30], "p_display_name": "Coach",
                                     "p_weight_unit": "kg", "p_length_unit": "cm",
                                     "p_timezone": "Europe/Madrid", "p_target_days": 3})
    r = http.post(f"{URL}/rest/v1/training_profiles", headers=user.headers, json={
        "goal": "general fitness", "experience": "beginner", "equipment": [],
        "available_weekdays": [1, 3, 5], "session_minutes": 60})
    assert r.status_code < 400, r.text


def test_concurrent_duplicate_and_cancel_during_generation():
    """Two simultaneous POSTs with one requestId -> one draft, one model run. Cancel while generating -> the late
    result is discarded by coach_save_draft and the response reports the stored (cancelled) state."""
    import asyncio

    catalog = load_catalog(DEFAULT_CATALOG)
    keys = [k for k, e in catalog.items() if e.load_mode == "bodyweight" and e.equipment == ("body weight",)][:2]
    plan = draft({1: [ex(keys[0])], 3: [ex(keys[1])]})
    provider = ScriptedProvider(interpret=[("sleep", 1.0), ("sleep", 1.0)], generate=[plan, plan])
    settings = replace(BASE_SETTINGS, supabase_url=URL, supabase_anon_key=ANON, timeout_seconds=30)
    app = create_app(settings=settings, provider=provider, catalog=catalog)

    with httpx.Client(timeout=20) as http:
        c = User(http, "c")
        _profile(http, c, "c")

        async def scenario():
            auth = {"Authorization": f"Bearer {c.token}"}
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", timeout=30) as api:
                def post(rid):
                    return api.post("/v1/coach/drafts", headers=auth, json={
                        "requestId": rid, "mode": "create", "programId": None, "baseRevision": None,
                        "preferencesText": "Full body"})

                rid = nid()
                a, b = await asyncio.gather(post(rid), post(rid))
                assert a.status_code == b.status_code == 200
                assert a.json()["draftId"] == b.json()["draftId"]
                assert {a.json()["status"], b.json()["status"]} <= {"ready", "pending"}
                assert provider.count("interpret") == 1

                rid2 = nid()
                task = asyncio.create_task(post(rid2))
                await asyncio.sleep(0.4)  # provider is "thinking"
                rows = http.get(f"{URL}/rest/v1/coach_drafts", headers=c.headers,
                                params={"request_id": f"eq.{rid2}", "select": "id,status"}).json()
                assert rows and rows[0]["status"] == "pending"
                cancelled = await api.post(f"/v1/coach/drafts/{rows[0]['id']}/cancel", headers=auth)
                assert cancelled.json()["status"] == "cancelled"
                late = await task
                assert late.status_code == 200 and late.json()["status"] == "cancelled", late.json()
                return rid

        rid = asyncio.run(scenario())
        rows = http.get(f"{URL}/rest/v1/coach_drafts", headers=c.headers, params={"request_id": f"eq.{rid}"}).json()
        assert len(rows) == 1
        assert c.active() is None  # nothing activated without approval


# ------------------------------------------------------------------ limits under real concurrency
# Each thread has its own httpx.Client (own TCP connection -> own PostgREST/DB connection) and they start together.

def _race(fns):
    import threading

    barrier = threading.Barrier(len(fns))
    out: list = [None] * len(fns)

    def run(i, fn):
        barrier.wait()
        out[i] = fn()

    threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(fns)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


def _begin(user: User, request_id: str, daily_cap=None) -> httpx.Response:
    with httpx.Client(timeout=20) as own:
        return own.post(f"{URL}/rest/v1/rpc/coach_begin_request", headers=user.headers, json={
            "p_request_id": request_id, "p_mode": "create", "p_program_id": None, "p_base_revision": None,
            "p_input": {}, "p_hourly_limit": None, "p_daily_cap": daily_cap})


def _count(http: httpx.Client, user: User, table: str) -> int:
    return len(http.get(f"{URL}/rest/v1/{table}", headers=user.headers, params={"select": "request_id"}).json())


def test_last_hourly_slot_under_concurrency():
    with httpx.Client(timeout=20) as http:
        u = User(http, "hour")
        for _ in range(9):
            assert _begin(u, nid()).status_code == 200
        results = _race([lambda: _begin(u, nid()) for _ in range(5)])
        codes = sorted(r.status_code for r in results)
        assert codes == [200, 429, 429, 429, 429], codes
        assert all(r.json()["message"] == "rate_limited" for r in results if r.status_code == 429)
        assert _count(http, u, "coach_requests") == 10 and _count(http, u, "coach_drafts") == 10


def _daily_used() -> int | None:
    """Today's global counter via psql in the local DB container (private schema is not exposed over REST)."""
    import subprocess

    container = os.environ.get("COACH_TEST_DB_CONTAINER", "supabase_db_ai-gym-app")
    try:
        out = subprocess.run(["docker", "exec", container, "psql", "-U", "postgres", "-d", "postgres", "-tAc",
                              "select coalesce((select requests from private.coach_daily_usage "
                              "where day = (now() at time zone 'utc')::date), 0)"],
                             capture_output=True, text=True, timeout=30, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    return int(out.stdout.strip())


def test_last_daily_budget_slot_across_users_under_concurrency():
    with httpx.Client(timeout=20) as http:
        users = [User(http, f"day{i}") for i in range(5)]
        used = _daily_used()
        if used is None:
            pytest.skip("docker/psql not available to read the daily counter")
        cap = used + 1  # exactly one slot left (assumes no other coach traffic on this local DB meanwhile)
        results = _race([lambda u=u: _begin(u, nid(), cap) for u in users])
        codes = sorted(r.status_code for r in results)
        assert codes == [200, 429, 429, 429, 429], codes
        assert all(r.json()["message"] == "budget_exhausted" for r in results if r.status_code == 429)
        assert sum(_count(http, u, "coach_drafts") + _count(http, u, "coach_requests") for u in users) == 2
        assert _daily_used() == cap  # rejected attempts did not consume budget


def test_duplicate_request_id_fired_concurrently_through_the_app():
    import asyncio

    catalog = load_catalog(DEFAULT_CATALOG)
    keys = [k for k, e in catalog.items() if e.load_mode == "bodyweight" and e.equipment == ("body weight",)][:2]
    provider = ScriptedProvider(interpret=[("sleep", 1.0)], generate=[draft({1: [ex(keys[0])], 3: [ex(keys[1])]})])
    settings = replace(BASE_SETTINGS, supabase_url=URL, supabase_anon_key=ANON, timeout_seconds=30)
    app = create_app(settings=settings, provider=provider, catalog=catalog)
    n = 6

    with httpx.Client(timeout=20) as http:
        u = User(http, "dup")
        _profile(http, u, "dup")
        rid = nid()

        async def fire():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", timeout=30) as api:
                return await asyncio.gather(*(api.post("/v1/coach/drafts", headers={"Authorization": f"Bearer {u.token}"},
                                                       json={"requestId": rid, "mode": "create", "programId": None,
                                                             "baseRevision": None, "preferencesText": "Full body"})
                                              for _ in range(n)))

        responses = asyncio.run(fire())
        assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
        assert len({r.json()["draftId"] for r in responses}) == 1
        assert sorted(r.json()["status"] for r in responses) == ["pending"] * (n - 1) + ["ready"]
        assert len(provider.calls) == 2  # one interpret + one generate in total
        assert _count(http, u, "coach_drafts") == 1 and _count(http, u, "coach_requests") == 1
