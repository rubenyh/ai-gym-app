"""Server-only settings from the environment (template: repo-root .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_CATALOG = Path(__file__).resolve().parents[3] / "app" / "assets" / "catalog" / "exercises.v1.json"

# Versioned training bounds used by validate_draft. Sanity limits for a generated plan, NOT medical
# guarantees. Change values only by bumping the version.
DRAFT_RULES = {
    "version": 1,
    "setsMin": 1,
    "setsMax": 6,
    "repsMin": 1,
    "repsMax": 30,
    "restMin": 30,
    "restMax": 300,
    "maxExercisesPerDay": 10,
    # Duration estimate: each rep ~4 s, plus rest after every set, plus setup per exercise.
    "secondsPerRep": 4,
    "defaultRestSeconds": 90,
    "setupSecondsPerExercise": 60,
    "durationTolerance": 1.15,
}


def _placeholder(value: str | None) -> str | None:
    """Template placeholders ('replace-…') count as missing configuration."""
    if not value or value.startswith("replace"):
        return None
    return value


@dataclass(frozen=True)
class Settings:
    supabase_url: str | None
    supabase_anon_key: str | None
    provider: str  # 'gemini' (only real provider); tests inject a scripted provider directly
    gemini_api_key: str | None
    gemini_model: str | None
    timeout_seconds: float
    max_repairs: int
    max_output_tokens: int
    max_context_chars: int
    max_candidates: int
    user_requests_per_hour: int
    daily_request_cap: int
    catalog_path: Path

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ.get
        return cls(
            supabase_url=_placeholder(env("SUPABASE_URL")),
            supabase_anon_key=_placeholder(env("SUPABASE_ANON_KEY")),
            provider=env("COACH_PROVIDER", "gemini"),
            gemini_api_key=_placeholder(env("GEMINI_API_KEY")),
            gemini_model=_placeholder(env("GEMINI_MODEL")),
            timeout_seconds=float(env("COACH_REQUEST_TIMEOUT_SECONDS", "90")),
            # AI_COACH.md: at most one repair, whatever the env says.
            max_repairs=min(1, int(env("COACH_MAX_REPAIR_ATTEMPTS", "1"))),
            max_output_tokens=int(env("COACH_MAX_OUTPUT_TOKENS", "4096")),
            max_context_chars=int(env("COACH_MAX_CONTEXT_CHARS", "12000")),
            max_candidates=int(env("COACH_MAX_CANDIDATES", "120")),
            user_requests_per_hour=int(env("COACH_USER_REQUESTS_PER_HOUR", "10")),
            daily_request_cap=int(env("COACH_DAILY_REQUEST_CAP", "200")),
            catalog_path=Path(env("COACH_CATALOG_PATH") or DEFAULT_CATALOG),
        )
