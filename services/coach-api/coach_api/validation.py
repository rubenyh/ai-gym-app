"""validate_draft: Pydantic schema + deterministic checks. Runs outside the model, always."""

from __future__ import annotations

import json

from pydantic import ValidationError

from .catalog import Exercise
from .config import DRAFT_RULES
from .models import DraftContent, TrainingProfile


def parse_draft(raw: str) -> tuple[DraftContent | None, list[str]]:
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None, ["Output is not valid JSON."]
    try:
        return DraftContent.model_validate(data), []
    except ValidationError as e:
        return None, [
            f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in e.errors(include_url=False)[:20]
        ]


def estimate_day_seconds(day, rules=DRAFT_RULES) -> int:
    total = 0
    for ex in day.exercises:
        rest = ex.rest_seconds if ex.rest_seconds is not None else rules["defaultRestSeconds"]
        total += rules["setupSecondsPerExercise"] + ex.sets * (ex.reps_max * rules["secondsPerRep"] + rest)
    return total


def check_draft(
    draft: DraftContent,
    profile: TrainingProfile,
    candidates: dict[str, Exercise],
    excluded_keys: set[str],
    rules=DRAFT_RULES,
) -> list[str]:
    errors: list[str] = []
    available = set(profile.available_weekdays)
    weekdays = [d.weekday for d in draft.days]
    if len(draft.days) > len(available):
        errors.append(f"Draft has {len(draft.days)} days but only {len(available)} are available.")
    if len(set(weekdays)) != len(weekdays):
        errors.append("Each weekday may appear at most once.")
    if not set(weekdays) <= available:
        errors.append(f"Weekdays {sorted(set(weekdays) - available)} are not in available weekdays {sorted(available)}.")
    budget = (profile.session_minutes or 0) * 60 * rules["durationTolerance"]

    for d in draft.days:
        where = f"weekday {d.weekday}"
        if len(d.exercises) > rules["maxExercisesPerDay"]:
            errors.append(f"{where}: more than {rules['maxExercisesPerDay']} exercises.")
        keys = [e.exercise_key for e in d.exercises]
        if len(set(keys)) != len(keys):
            errors.append(f"{where}: an exercise appears more than once.")
        for e in d.exercises:
            ref = f"{where} {e.exercise_key}"
            if e.exercise_key in excluded_keys:
                errors.append(f"{ref}: excluded by the user's limitations or request.")
            elif e.exercise_key not in candidates:
                errors.append(f"{ref}: not an allowed candidate ID (equipment or catalog).")
            if not rules["setsMin"] <= e.sets <= rules["setsMax"]:
                errors.append(f"{ref}: sets must be {rules['setsMin']}-{rules['setsMax']}.")
            if not rules["repsMin"] <= e.reps_min <= e.reps_max <= rules["repsMax"]:
                errors.append(f"{ref}: need {rules['repsMin']} <= repsMin <= repsMax <= {rules['repsMax']}.")
            if e.rest_seconds is not None and not rules["restMin"] <= e.rest_seconds <= rules["restMax"]:
                errors.append(f"{ref}: restSeconds must be {rules['restMin']}-{rules['restMax']} or null.")
        if budget and estimate_day_seconds(d, rules) > budget:
            errors.append(
                f"{where}: estimated {estimate_day_seconds(d, rules) // 60} min exceeds the "
                f"{profile.session_minutes} min session."
            )
    return errors
