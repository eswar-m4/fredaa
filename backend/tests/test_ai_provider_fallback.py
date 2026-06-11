from unittest.mock import patch
from app.services.ai_provider import AIProvider


def test_gemini_fallbacks_to_groq_on_rate_limit():
    provider = AIProvider(api_key="dummy", model="gemini-1.5-flash")
    provider.primary.client = object()
    provider.fallback.client = object()

    with patch.object(provider.primary, "generate", side_effect=Exception("429 rate limit exceeded")) as mock_gemini:
        with patch.object(provider.fallback, "generate", return_value="groq fallback response") as mock_groq:
            result = provider.generate("Analyze this prompt.")

    assert result == "groq fallback response"
    assert provider.provider_used == "groq"
    assert provider.fallback_triggered is True
    mock_gemini.assert_called_once()
    mock_groq.assert_called_once()
