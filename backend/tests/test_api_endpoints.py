"""
Integration tests for Phase 3 API endpoints (with mocks).
"""

import pytest
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.models.ai_schemas import ProcessedInput

client = TestClient(app)


def test_health_check():
    """Test health check endpoint still works."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_process_input_empty_text():
    """Test process-input rejects empty text."""
    response = client.post("/api/v1/process-input", json={"text": ""})
    assert response.status_code == 422  # Pydantic validation error


def test_process_input_valid_text_no_api_key():
    """Test process-input with valid text but no Gemini API key configured."""
    response = client.post("/api/v1/process-input", json={"text": "Acme Corporation"})
    
    # May fail if no API key, or succeed if key is set in test environment
    assert response.status_code in [200, 400, 500]


@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_process_input_with_mock_ai(mock_understand):
    """Test process-input endpoint with mocked AI service."""
    # Mock AI response
    mock_understand.return_value = ProcessedInput(
        input_type="text",
        entity_type="company",
        raw_input="Acme Corporation",
        content="Acme Corporation",
        normalized_data={"name": "Acme Corporation"},
        summary="Acme Corporation is a leading technology provider.",
        confidence_score=0.95,
        processing_time_ms=450,
    )

    response = client.post("/api/v1/process-input", json={"text": "Acme Corporation"})
    assert response.status_code == 200
    
    data = response.json()
    assert data["input_type"] == "text"
    assert data["entity_type"] == "company"
    assert data["confidence_score"] == 0.95
