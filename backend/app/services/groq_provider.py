"""
Groq provider adapter for F.R.E.D.A.

This module uses the OpenAI-compatible SDK (v1.x) to route requests to Groq's
API as a fallback provider when Gemini is unavailable, rate-limited, or out of quota.
"""
from typing import Optional
import logging
from app.config import settings

logger = logging.getLogger(__name__)

try:
    from openai import OpenAI, APIError, RateLimitError, APITimeoutError, AuthenticationError
    _openai_available = True
except ImportError:
    OpenAI = None  # type: ignore
    APIError = Exception
    RateLimitError = Exception
    APITimeoutError = TimeoutError
    AuthenticationError = Exception
    _openai_available = False


class GroqProvider:
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        api_base: Optional[str] = None,
    ):
        self.model = model or settings.GROQ_MODEL
        self.api_base = api_base or settings.GROQ_API_BASE
        self.api_key = api_key or settings.GROQ_API_KEY or settings.OPENAI_API_KEY

        # If no Groq model set but OpenAI model is, use that as fallback label
        if not model and not settings.GROQ_MODEL and settings.OPENAI_MODEL:
            self.model = settings.OPENAI_MODEL

        self.client = None

        if not _openai_available:
            logger.warning("GroqProvider unavailable: openai SDK not installed.")
            return

        if not self.api_key:
            logger.warning(
                "GroqProvider unavailable: no API key found (GROQ_API_KEY / OPENAI_API_KEY)."
            )
            return

        try:
            # Use Groq base URL only when a Groq key is explicitly set
            base_url = self.api_base if settings.GROQ_API_KEY else None
            self.client = OpenAI(api_key=self.api_key, base_url=base_url)
            logger.info(
                "GroqProvider configured: model=%s base_url=%s",
                self.model,
                base_url or "https://api.openai.com/v1",
            )
        except Exception as exc:
            logger.warning("Failed to configure Groq/OpenAI provider: %s", exc)
            self.client = None

    def generate(self, prompt: str, timeout: int = 30, temperature: float = 0.3) -> str:
        if not self.client:
            raise ValueError(
                "Groq provider not configured. Set GROQ_API_KEY and install openai."
            )

        logger.info("Sending prompt to model %s via GroqProvider", self.model)
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=float(temperature),
                max_tokens=2048,
                timeout=float(timeout),
            )

            if not response.choices:
                raise ValueError("Groq response did not include any choices")

            content = response.choices[0].message.content
            if not content:
                raise ValueError("Groq response choice had empty content")
            return content

        except (RateLimitError, APITimeoutError) as exc:
            logger.error("Groq request failed (rate limit / timeout): %s", exc)
            raise
        except AuthenticationError as exc:
            logger.error("Groq authentication error: %s", exc)
            raise
        except APIError as exc:
            logger.error("Groq API error: %s", exc)
            raise
