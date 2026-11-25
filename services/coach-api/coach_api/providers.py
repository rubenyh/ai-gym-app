"""Model provider adapter. The model gets text in and returns JSON text; it has no tools."""

from __future__ import annotations

from typing import Any, Literal, Protocol

import httpx
from pydantic import BaseModel

from .config import Settings

Task = Literal["interpret", "generate"]


class ProviderError(Exception):
    """Recoverable provider failure. `code` goes to the client; provider text never does."""

    MESSAGES = {
        "quota_exceeded": "The coach is busy right now. Try again later.",
        "provider_unavailable": "The coach is temporarily unavailable. Try again.",
        "provider_timeout": "The coach took too long. Try again.",
        "safety_blocked": "The coach could not answer this request. Rephrase it and try again.",
        "empty_response": "The coach returned no answer. Try again.",
        "provider_error": "The coach is not available right now.",
    }

    def __init__(self, code: str, retryable: bool = True):
        super().__init__(code)
        self.code, self.retryable, self.message = code, retryable, self.MESSAGES[code]


class ModelProvider(Protocol):
    name: str

    async def complete(self, task: Task, system: str, prompt: str, schema: type[BaseModel]) -> str:
        """Return raw JSON text (validated in code afterwards) or raise ProviderError."""
        ...


_BLOCKED_FINISH = {"SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "RECITATION", "LANGUAGE", "OTHER"}


def _name(value: Any) -> str:
    return str(getattr(value, "name", value) or "")


class GeminiProvider:
    """Google GenAI SDK with structured output. Model name comes from GEMINI_MODEL (open decision O-08).

    The SDK does not retry by default, so each `complete` is one HTTP call; the request budget is enforced by the
    caller's asyncio deadline.
    """

    def __init__(self, api_key: str, model: str, max_output_tokens: int, client: Any = None):
        if client is None:
            from google import genai  # imported lazily so tests never need credentials

            client = genai.Client(api_key=api_key)
        self._client = client
        self._model = model
        self._max_tokens = max_output_tokens
        self.name = f"gemini:{model}"

    async def complete(self, task: Task, system: str, prompt: str, schema: type[BaseModel]) -> str:
        from google.genai import errors, types

        try:
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
        except errors.APIError as e:
            if e.code == 429:
                raise ProviderError("quota_exceeded") from None
            if e.code in (408, 504):
                raise ProviderError("provider_timeout") from None
            if e.code >= 500:
                raise ProviderError("provider_unavailable") from None
            raise ProviderError("provider_error", retryable=False) from None  # bad key/model/request: config issue
        except (httpx.TimeoutException, TimeoutError):
            raise ProviderError("provider_timeout") from None
        except httpx.HTTPError:
            raise ProviderError("provider_unavailable") from None

        feedback = getattr(response, "prompt_feedback", None)
        if feedback is not None and getattr(feedback, "block_reason", None):
            raise ProviderError("safety_blocked")
        candidates = getattr(response, "candidates", None) or []
        if candidates and _name(candidates[0].finish_reason) in _BLOCKED_FINISH:
            raise ProviderError("safety_blocked")
        text = response.text
        if not text or not text.strip():
            raise ProviderError("empty_response")
        return text  # MAX_TOKENS truncation surfaces as invalid JSON and goes through the single repair


def provider_from_settings(settings: Settings) -> ModelProvider | None:
    """None means 'coach unavailable' (503). Never substitutes a fake provider."""
    if settings.provider != "gemini" or not settings.gemini_api_key or not settings.gemini_model:
        return None
    return GeminiProvider(settings.gemini_api_key, settings.gemini_model, settings.max_output_tokens)
