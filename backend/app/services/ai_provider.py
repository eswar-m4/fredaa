"""
AI provider abstraction for F.R.E.D.A.

This module routes AI requests through Gemini as the primary provider and
falls back to Groq for quota, rate-limit, or service interruptions.
"""
from typing import Optional
import time
import logging
from app.config import settings
from app.services.groq_provider import GroqProvider

logger = logging.getLogger(__name__)

try:
    import google.generativeai as genai
    from google.api_core.exceptions import GoogleAPIError, ServiceUnavailable, Unauthenticated
except Exception:  # pragma: no cover - defensive import
    genai = None
    GoogleAPIError = Exception
    ServiceUnavailable = Exception
    Unauthenticated = Exception


class GeminiProvider:
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.model = model or settings.GEMINI_MODEL
        if isinstance(self.model, str) and self.model.startswith("GEMINI_MODEL="):
            self.model = self.model.split("=", 1)[1]
        self.model = str(self.model).strip().strip('"')
        self.client = None

        if api_key and genai:
            try:
                genai.configure(api_key=api_key)
                self.client = genai
                sdk_ver = getattr(genai, "__version__", "unknown")
                logger.info(f"Gemini provider configured for model={self.model} (genai v{sdk_ver})")
            except Exception as exc:
                logger.warning(f"Unable to configure Gemini provider: {exc}")
                self.client = None
        else:
            logger.warning("Gemini provider unavailable: API key missing or genai unavailable")

    def generate(self, prompt: str, timeout: int = 30, temperature: float = 0.3) -> str:
        if not self.client:
            raise ValueError("Gemini provider not configured.")

        logger.info(f"Instantiating Gemini model {self.model}")
        try:
            available = [m.name for m in self.client.list_models()]
        except Exception:
            available = []

        candidate = self.model
        if "/" not in candidate:
            candidate = "models/" + candidate

        chosen = candidate
        if available and candidate not in available:
            if "models/gemini-flash-latest" in available:
                chosen = "models/gemini-flash-latest"
            else:
                for m in self.client.list_models():
                    if "gemini" in m.name and "generateContent" in getattr(m, "supported_generation_methods", []):
                        chosen = m.name
                        break

            logger.info(f"Gemini model fallback selected: {chosen}")

        model_obj = self.client.GenerativeModel(model_name=chosen)
        response = model_obj.generate_content(
            prompt,
            generation_config={
                "temperature": float(temperature),
                "top_p": 0.8,
            },
            request_options={"timeout": int(timeout)},
        )

        text = getattr(response, "text", None)
        if text is None:
            text = str(response)
        return text


class AIProvider:
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.primary = GeminiProvider(api_key=api_key, model=model)
        self.fallback = GroqProvider(
            api_key=settings.GROQ_API_KEY,
            model=settings.GROQ_MODEL,
            api_base=settings.GROQ_API_BASE,
        )
        self.provider_used = "gemini"
        self.fallback_triggered = False

    @property
    def client(self):
        return self.primary.client or self.fallback.client

    @property
    def model_name(self) -> str:
        if self.provider_used == "groq":
            return self.fallback.model
        return self.primary.model

    def _should_fallback(self, error: Exception) -> bool:
        message = str(error).lower()
        if isinstance(error, (ServiceUnavailable,)):
            return True
        if "rate limit" in message or "quota" in message or "429" in message:
            return True
        if "timeout" in message or "timed out" in message:
            return True
        return False

    def generate(self, prompt: str, timeout: int = 30, temperature: float = 0.3) -> str:
        if self.primary.client is None and self.fallback.client is None:
            raise ValueError("No AI provider is configured. Set GEMINI_API_KEY or GROQ_API_KEY.")

        if self.primary.client:
            try:
                result = self.primary.generate(prompt, timeout=timeout, temperature=temperature)
                self.provider_used = "gemini"
                self.fallback_triggered = False
                return result
            except Exception as exc:
                # If rate limit / quota, attempt a small retry sequence before failing over
                if self._should_fallback(exc):
                    logger.warning(f"Gemini initial failure ({exc}); attempting short retries before failover")
                    # small backoff retries
                    for wait in (1, 2):
                        try:
                            time.sleep(wait)
                            result = self.primary.generate(prompt, timeout=timeout, temperature=temperature)
                            self.provider_used = "gemini"
                            self.fallback_triggered = False
                            logger.info("Gemini recovered after retry")
                            return result
                        except Exception as retry_exc:
                            logger.warning(f"Gemini retry failed after {wait}s: {retry_exc}")
                            exc = retry_exc
                    # After retries, attempt fallback if available
                    if self.fallback.client:
                        logger.warning(f"Gemini failed with {exc}. Falling back to Groq/OpenAI.")
                        self.provider_used = "groq"
                        self.fallback_triggered = True
                        return self.fallback.generate(prompt, timeout=timeout, temperature=temperature)
                # Not a fallbackable error or no fallback available — re-raise
                raise

        if self.fallback.client:
            self.provider_used = "groq"
            self.fallback_triggered = True
            return self.fallback.generate(prompt, timeout=timeout, temperature=temperature)

        raise ValueError("AI provider not configured for Gemini or Groq.")
