"""Pydantic mirrors of the frozen contracts in app/src/domain/contracts.ts (coach section).

JSON keys are camelCase on the wire; Python attributes are snake_case. Inputs accept either form.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
CATALOG_KEY_RE = r"^catalog:[A-Za-z0-9_-]{1,64}$"

Uuid = Annotated[str, StringConstraints(pattern=UUID_RE)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class StrictCamel(Camel):
    """Model output: unknown keys (e.g. invented loads) are validation errors."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


# ------------------------------------------------------------------ coachDraftContent


class DraftExercise(StrictCamel):
    exercise_key: Annotated[str, StringConstraints(pattern=CATALOG_KEY_RE)]
    exercise_name: Name
    sets: int = Field(ge=1, le=10)
    reps_min: int = Field(ge=1, le=50)
    reps_max: int = Field(ge=1, le=50)
    rest_seconds: int | None = Field(ge=0, le=3600)


class DraftDay(StrictCamel):
    weekday: int = Field(ge=1, le=7)
    routine_name: Name
    exercises: list[DraftExercise] = Field(min_length=1, max_length=12)


class DraftContent(StrictCamel):
    title: Name
    explanation: str = Field(max_length=4000)
    assumptions: list[Annotated[str, StringConstraints(max_length=500)]] = Field(max_length=20)
    days: list[DraftDay] = Field(min_length=1, max_length=7)


# ------------------------------------------------------------------ HTTP request / response


class CoachDraftRequest(Camel):
    request_id: Uuid
    mode: Literal["create", "adjust"]
    program_id: Uuid | None = None
    base_revision: int | None = Field(default=None, ge=1)
    preferences_text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class Clarification(Camel):
    field: str
    question: str


class CoachError(Camel):
    code: str
    message: str
    retryable: bool


DraftStatus = Literal["pending", "ready", "needs_input", "failed", "approved", "cancelled"]


class CoachDraftResponse(Camel):
    draft_id: Uuid
    request_id: Uuid
    status: DraftStatus
    base_program_id: Uuid | None = None
    base_program_revision: int | None = None
    draft: DraftContent | None = None
    clarification: Clarification | None = None
    error: CoachError | None = None


# ------------------------------------------------------------------ server-side context (coach_get_context)


class TrainingProfile(Camel):
    goal: str | None = None
    age: int | None = None
    height_cm: float | None = None
    experience: Literal["beginner", "intermediate", "advanced"] | None = None
    equipment: list[str] = []
    limitations: str | None = None
    available_weekdays: list[int] = []
    session_minutes: int | None = None


class ActiveProgram(Camel):
    doc: dict
    revision: int


class CoachContext(Camel):
    training_profile: TrainingProfile | None = None
    active_program: ActiveProgram | None = None
    routines: list[dict] = []
    recent_sessions: list[dict] = []


# ------------------------------------------------------------------ interpret_request output


class IntentClarification(StrictCamel):
    field: str = Field(max_length=40)
    question: str = Field(max_length=300)


class Intent(StrictCamel):
    """Typed interpretation. It can only narrow what code allows (exclusions), never widen it."""

    summary: str = Field(default="", max_length=500)
    priority_muscles: list[Annotated[str, StringConstraints(max_length=40)]] = Field(default=[], max_length=10)
    exclude_terms: list[Annotated[str, StringConstraints(max_length=40)]] = Field(default=[], max_length=20)
    requested_days_per_week: int | None = Field(default=None, ge=1, le=7)
    clarification: IntentClarification | None = None


def is_uuid(value: str) -> bool:
    return bool(re.match(UUID_RE, value))
