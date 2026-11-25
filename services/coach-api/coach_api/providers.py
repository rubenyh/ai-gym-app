"""Model provider adapter. The model gets text in and returns JSON text; it has no tools."""

from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel

from .config import Settings

Task = Literal["interpret", "generate"]


class ModelProvider(Protocol):
    name: str

    async def complete(self, task: Task, system: str, prompt: str, schema: type[BaseModel]) -> str:
        """Return raw JSON text. Validation always happens in code afterwards."""
        ...


class GeminiProvider:
    """Google GenAI SDK with structured output. Model name comes from GEMINI_MODEL (open decision O-08)."""

    def __init__(self, api_key: str, model: str, max_output_tokens: int):
        from google import genai  # imported lazily so tests never need credentials

        self._client = genai.Client(api_key=api_key)
        self._model = model
        self._max_tokens = max_output_tokens
        self.name = f"gemini:{model}"

    async def complete(self, task: Task, system: str, prompt: str, schema: type[BaseModel]) -> str:
        from google.genai import types

        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_json_schema=schema.model_json_schema(by_alias=True),
                max_output_tokens=self._max_tokens,
                temperature=0.3,
            ),
        )
        return response.text or ""


def provider_from_settings(settings: Settings) -> ModelProvider | None:
    """None means 'coach unavailable' (503). Never substitutes a fake provider."""
    if settings.provider != "gemini" or not settings.gemini_api_key or not settings.gemini_model:
        return None
    return GeminiProvider(settings.gemini_api_key, settings.gemini_model, settings.max_output_tokens)
