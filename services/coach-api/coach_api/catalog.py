"""Trusted exercise catalog (shape = CatalogExercise in app/src/domain/contracts.ts) and code-side filtering."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

BODYWEIGHT = "body weight"


@dataclass(frozen=True)
class Exercise:
    key: str
    name: str
    target: str
    primary_muscles: tuple[str, ...]
    equipment: tuple[str, ...]
    load_mode: str

    def mentions(self, term: str) -> bool:
        term = term.lower().strip()
        haystack = [self.name, self.target, *self.primary_muscles]
        return bool(term) and any(term in h.lower() for h in haystack)


def load_catalog(path: Path) -> dict[str, Exercise]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data["exercises"] if isinstance(data, dict) else data  # {version, source, count, exercises} envelope
    return {
        f"catalog:{r['sourceId']}": Exercise(
            key=f"catalog:{r['sourceId']}",
            name=r["name"],
            target=r.get("target") or "",
            primary_muscles=tuple(r.get("primaryMuscles") or []),
            equipment=tuple(e.lower() for e in r.get("equipment") or []),
            load_mode=r["loadMode"],
        )
        for r in rows
    }


def normalize_equipment(profile_equipment: list[str]) -> set[str]:
    return {e.strip().lower() for e in profile_equipment if e.strip()} | {BODYWEIGHT}


def select_candidates(
    catalog: dict[str, Exercise],
    equipment: list[str],
    exclude_terms: list[str],
    priority_muscles: list[str],
    limit: int,
) -> list[Exercise]:
    """Equipment the user has, a supported load mode, no excluded term; priority muscles first."""
    have = normalize_equipment(equipment)
    out = []
    for ex in catalog.values():
        if ex.load_mode not in ("external", "bodyweight", "assisted"):
            continue
        # External load with unknown equipment cannot be checked against the profile.
        if ex.load_mode == "external" and not ex.equipment:
            continue
        if not set(ex.equipment or (BODYWEIGHT,)) <= have:
            continue
        if any(ex.mentions(t) for t in exclude_terms):
            continue
        out.append(ex)
    out.sort(key=lambda ex: (not any(ex.mentions(m) for m in priority_muscles), ex.key))
    return out[:limit]
