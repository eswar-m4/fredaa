"""
Unit tests for GeminiFallbackService.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.gemini_fallback_service import (
    GeminiFallbackService,
    build_prompt,
    build_labor_market_prompt,
    merge_ai_fallback_values,
    unique_attributes_for_workflows,
    WORKFLOW_SOURCES,
)


def test_unique_attributes_for_workflows():
    attrs = unique_attributes_for_workflows(["company_data", "sec_data"])
    assert "Legal Name" in attrs
    assert "Revenue (USD-normalized)" in attrs
    assert len(attrs) == len(set(attrs))


def test_build_labor_market_prompt():
    prompt = build_labor_market_prompt(["Tesla", "Netflix"])
    assert "Labor Market Intelligence Extraction Assistant" in prompt
    assert "- Tesla" in prompt
    assert "- Netflix" in prompt
    assert "Return ONLY the JSON array." in prompt


def test_build_prompt_generic():
    prompt = build_prompt(["Acme Corp"], ["Legal Name", "Industry"], ["company_data"])
    assert "corporate data extraction assistant" in prompt
    assert "- Acme Corp" in prompt
    assert "Legal Name" in prompt
    assert "Return ONLY a valid JSON array of arrays." in prompt


def test_merge_ai_fallback_values_preserves_existing_fields():
    record = {
        "legal_name": "Acme Corp",
        "website": "",
        "email": None,
    }
    merged = merge_ai_fallback_values(
        record,
        {
            "Legal Name": "Acme Holdings",
            "Website": "https://acme.com",
            "Email": "info@acme.com",
        },
        requested_fields=["Legal Name", "Website", "Email"],
    )

    assert merged["legal_name"] == "Acme Corp"
    assert merged["website"] == "https://acme.com"
    assert merged["email"] == "info@acme.com"
    assert merged["_ai_enrichment"]["confidence"] == 50
    assert merged["_field_provenance"]["website"]["source"] == "ai_fallback"
    assert "legal_name" not in merged.get("_ai_enrichment", {}).get("filled_fields", {})


@pytest.mark.asyncio
async def test_extract_fallback_data_prefers_lovable_key(monkeypatch):
    service = GeminiFallbackService()
    mock_content = "[[\"Acme Corp\", \"Acme Holdings\", \"Software\"]]"

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{"message": {"content": mock_content}}]
    }

    monkeypatch.setenv("LOVABLE_API_KEY", "lovable-token")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-token")

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        results = await service.extract_fallback_data(
            entities=["Acme Corp"],
            attributes=["Legal Name", "Industry"],
            workflow_ids=["company_data"],
        )

        assert len(results) == 1
        assert results[0]["entity"] == "Acme Corp"
        assert mock_post.await_count == 1
        _, kwargs = mock_post.await_args
        assert kwargs["headers"]["Authorization"] == "Bearer lovable-token"


@pytest.mark.asyncio
async def test_extract_fallback_data_mock_response():
    service = GeminiFallbackService()

    mock_content = '```json\n[["Tesla", "Tesla Inc", "Motor Vehicles"]]\n```'

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{"message": {"content": mock_content}}]
    }

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response
        results = await service.extract_fallback_data(
            entities=["Tesla"],
            attributes=["Legal Name", "Industry"],
            workflow_ids=["company_data"],
            api_key="mock_key",
        )

        assert len(results) == 1
        assert results[0]["entity"] == "Tesla"
        extracted = results[0]["extracted"]
        assert extracted.get("Legal Name") == "Tesla Inc"
        assert extracted.get("Industry") == "Motor Vehicles"
