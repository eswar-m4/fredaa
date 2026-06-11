"""
Groq provider adapter for F.R.E.D.A.

This module uses an OpenAI-compatible SDK to route requests to Groq's API as a
fallback provider when Gemini is unavailable, rate-limited, or out of quota.
"""
from typing import Optional
import logging
from app.config import settings

logger = logging.getLogger(__name__)

try:
    import openai
    from openai.error import OpenAIError, RateLimitError, Timeout as OpenAITimeout, ServiceUnavailableError, AuthenticationError
except Exception:  # pragma: no cover - defensive import
    openai = None
    OpenAIError = Exception
    RateLimitError = Exception
    OpenAITimeout = TimeoutError
    ServiceUnavailableError = Exception
    AuthenticationError = Exception


class GroqProvider:
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        api_base: Optional[str] = None,
    ):
        # Prefer explicit api_key, then GROQ key, then OPENAI key (fallback)
        self.model = model or settings.GROQ_MODEL
        self.api_base = api_base or settings.GROQ_API_BASE
        self.api_key = api_key or settings.GROQ_API_KEY or settings.OPENAI_API_KEY
        # If using OpenAI key as fallback, prefer OPENAI_MODEL when available
        if not model and not settings.GROQ_MODEL and settings.OPENAI_MODEL:
            self.model = settings.OPENAI_MODEL
        self.client = None

        if self.api_key and openai:
            try:
                openai.api_key = self.api_key
                # Only set api_base if explicitly provided for Groq
                if settings.GROQ_API_KEY and self.api_base:
                    openai.api_base = self.api_base
                self.client = openai
                logger.info(f"GroqProvider/OpenAI configured for model={self.model} api_base={self.api_base}")
            except Exception as exc:
                logger.warning(f"Failed to configure Groq/OpenAI provider: {exc}")
                self.client = None
        else:
            logger.warning("GroqProvider unavailable: openai SDK not installed or API key missing (GROQ_API_KEY/OPENAI_API_KEY)")

    def generate(self, prompt: str, timeout: int = 30, temperature: float = 0.3) -> str:
        if not self.client:
            raise ValueError("Groq provider not configured. Set GROQ_API_KEY and install openai.")

        logger.info(f"Sending prompt to Groq model {self.model}")
        try:
            response = self.client.ChatCompletion.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=float(temperature),
                max_tokens=2048,
                request_timeout=int(timeout),
            )

            choice = None
            if hasattr(response, "choices") and response.choices:
                choice = response.choices[0]
            if not choice:
                raise ValueError("Groq response did not include any choices")

            message = getattr(choice, "message", None)
            if message and isinstance(message, dict):
                text = message.get("content")
            else:
                text = getattr(choice, "text", None)

            if not text:
                text = str(response)
            return text

        except (RateLimitError, ServiceUnavailableError, OpenAITimeout) as exc:
            logger.error(f"Groq request failed: {exc}")
            raise
        except OpenAIError as exc:
            logger.error(f"Groq provider error: {exc}")
            raise
