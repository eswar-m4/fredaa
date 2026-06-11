import io
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.models.ai_schemas import ProcessedInput

client = TestClient(app)

@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_company_name(mock_understand):
    mock_understand.return_value = ProcessedInput(
        input_type="text",
        entity_type="company",
        raw_input="Acme Corporation",
        content="Acme Corporation",
        normalized_data={"name": "Acme Corporation"},
        summary="Recognized as company Acme Corporation",
        confidence_score=0.98,
        attributes={"name": "Acme Corporation"},
        processing_time_ms=120,
    )

    resp = client.post("/api/v1/process-input", json={"text": "Acme Corporation"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["entity_type"] == "company"
    assert data["confidence_score"] == 0.98

@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_email_detection(mock_understand):
    mock_understand.return_value = ProcessedInput(
        input_type="text",
        entity_type="email",
        raw_input="contact@acme.com",
        content="contact@acme.com",
        normalized_data={"email": "contact@acme.com"},
        summary="Detected email address",
        confidence_score=0.9,
        attributes={"email": "contact@acme.com"},
        processing_time_ms=80,
    )

    resp = client.post("/api/v1/process-input", json={"text": "contact@acme.com"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["entity_type"] == "email"

@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_url_detection(mock_understand):
    mock_understand.return_value = ProcessedInput(
        input_type="text",
        entity_type="url",
        raw_input="https://example.com",
        content="https://example.com",
        normalized_data={"url": "https://example.com"},
        summary="Detected URL",
        confidence_score=0.92,
        attributes={"url": "https://example.com"},
        processing_time_ms=75,
    )

    resp = client.post("/api/v1/process-input", json={"text": "https://example.com"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["entity_type"] == "url"

@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_partial_record(mock_understand):
    mock_understand.return_value = ProcessedInput(
        input_type="text",
        entity_type="person",
        raw_input="John Doe, Acme",
        content="John Doe, Acme",
        normalized_data={"name": "John Doe", "company": "Acme"},
        summary="Partial record parsed",
        confidence_score=0.75,
        attributes={"name": "John Doe", "company": "Acme"},
        processing_time_ms=100,
    )

    resp = client.post("/api/v1/process-input", json={"text": "John Doe, Acme"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["entity_type"] == "person"

@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_csv_upload_and_process(mock_understand):
    mock_understand.return_value = ProcessedInput(
        input_type="file",
        entity_type="csv",
        raw_input="data.csv",
        content="id,name,email\n1,Acme,contact@acme.com",
        normalized_data={"rows": 1},
        summary="CSV parsed and analyzed",
        confidence_score=0.85,
        attributes={"row_count": 1},
        processing_time_ms=300,
    )

    csv_bytes = b"id,name,email\n1,Acme,contact@acme.com\n"
    files = {"file": ("data.csv", io.BytesIO(csv_bytes), "text/csv")}
    resp = client.post("/api/v1/process-file", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["entity_type"] == "csv" or data["input_type"] == "file"
