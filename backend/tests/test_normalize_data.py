import io
import json
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


@patch("app.services.parser_service.ParserService.parse")
@patch("app.services.schema_inference_service.SchemaInferenceService._call_gemini_api")
@patch("app.services.ai_understanding_service.AIUnderstandingService._call_gemini_api")
def test_normalize_multiple_csv_uploads(mock_ai, mock_schema_ai, mock_parse):
    mock_ai.return_value = json.dumps({
        "entity_type": "organization",
        "normalized_data": {"name": "Acme Corporation"},
        "summary": "Company detected",
        "confidence_score": 0.95,
        "attributes": {"name": "Acme Corporation"}
    })
    mock_schema_ai.return_value = json.dumps({
        "dataset_type": "customer_contacts",
        "primary_entity": "person",
        "confidence_score": 0.95,
        "schema": [
            {"original_field": "cust_nm", "standardized_field": "name", "confidence": 0.98, "category": "person_attribute"}
        ]
    })

    def parse_side(content, file_format):
        text = content.decode("utf-8")
        if "cust_nm" in text:
            return {"format": "csv", "columns": ["cust_nm", "mailid"], "sample": [{"cust_nm": "Acme", "mailid": "sales@acme.com"}], "row_count": 1}
        return {"format": "csv", "columns": ["emp_name", "dept"], "sample": [{"emp_name": "Jane Doe", "dept": "Engineering"}], "row_count": 1}

    mock_parse.side_effect = parse_side

    files = [
        ("files", ("crm.csv", io.BytesIO(b"cust_nm,mailid\nAcme,sales@acme.com\n"), "text/csv")),
        ("files", ("employees.csv", io.BytesIO(b"emp_name,dept\nJane Doe,Engineering\n"), "text/csv")),
    ]

    response = client.post("/api/v1/normalize-data", files=files)
    assert response.status_code == 200
    body = response.json()
    assert body["total_files"] == 2
    assert len(body["processed_files"]) == 2
    assert {item["file_name"] for item in body["processed_files"]} == {"crm.csv", "employees.csv"}
    assert body["combined_summary"]["total_entities"] == 2


@patch("app.services.parser_service.ParserService.parse")
@patch("app.services.schema_inference_service.SchemaInferenceService._call_gemini_api")
@patch("app.services.ai_understanding_service.AIUnderstandingService._call_gemini_api")
def test_normalize_mixed_file_uploads(mock_ai, mock_schema_ai, mock_parse):
    mock_ai.return_value = json.dumps({
        "entity_type": "person",
        "normalized_data": {"name": "Jane Doe"},
        "summary": "Person profile detected",
        "confidence_score": 0.90,
        "attributes": {"name": "Jane Doe"}
    })
    mock_schema_ai.return_value = json.dumps({
        "dataset_type": "resume_data",
        "primary_entity": "person",
        "confidence_score": 0.90,
        "schema": [
            {"original_field": "emp_name", "standardized_field": "name", "confidence": 0.95, "category": "person_attribute"}
        ]
    })

    def parse_side(content, file_format):
        if file_format == "csv":
            return {"format": "csv", "columns": ["emp_name", "yrs_exp"], "sample": [{"emp_name": "Jane Doe", "yrs_exp": "5"}], "row_count": 1}
        return {"format": "docx", "columns": [], "sample": [], "text_preview": "Jane Doe is an engineering manager."}

    mock_parse.side_effect = parse_side

    files = [
        ("files", ("resume.docx", io.BytesIO(b"Fake DOCX content"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
        ("files", ("staff.csv", io.BytesIO(b"emp_name,yrs_exp\nJane Doe,5\n"), "text/csv")),
    ]

    response = client.post("/api/v1/normalize-data", files=files)
    assert response.status_code == 200
    body = response.json()
    assert body["total_files"] == 2
    assert len(body["processed_files"]) == 2
    assert body["combined_summary"]["total_entities"] == 2
    assert "resume.docx" in {item["file_name"] for item in body["processed_files"]}


@patch("app.services.parser_service.ParserService.parse")
@patch("app.services.schema_inference_service.SchemaInferenceService._call_gemini_api")
@patch("app.services.ai_understanding_service.AIUnderstandingService._call_gemini_api")
def test_normalize_one_failed_one_successful_file(mock_ai, mock_schema_ai, mock_parse):
    mock_ai.return_value = json.dumps({
        "entity_type": "organization",
        "normalized_data": {"name": "Acme Corporation"},
        "summary": "Company detected",
        "confidence_score": 0.95,
        "attributes": {"name": "Acme Corporation"}
    })
    mock_schema_ai.return_value = json.dumps({
        "dataset_type": "customer_contacts",
        "primary_entity": "person",
        "confidence_score": 0.95,
        "schema": [
            {"original_field": "cust_nm", "standardized_field": "name", "confidence": 0.98, "category": "person_attribute"}
        ]
    })

    def parse_side(content, file_format):
        text = content.decode("utf-8")
        if "broken" in text:
            raise ValueError("PDF extraction failed")
        return {"format": "csv", "columns": ["cust_nm", "mailid"], "sample": [{"cust_nm": "Acme", "mailid": "sales@acme.com"}], "row_count": 1}

    mock_parse.side_effect = parse_side

    files = [
        ("files", ("broken.pdf", io.BytesIO(b"broken content"), "application/pdf")),
        ("files", ("crm.csv", io.BytesIO(b"cust_nm,mailid\nAcme,sales@acme.com\n"), "text/csv")),
    ]

    response = client.post("/api/v1/normalize-data", files=files)
    assert response.status_code == 200
    body = response.json()
    assert body["total_files"] == 2
    assert any(item["status"] == "failed" for item in body["processed_files"])
    assert any(item["status"] == "success" for item in body["processed_files"])
    assert body["combined_summary"]["total_entities"] == 1


def test_normalize_empty_upload_list():
    response = client.post("/api/v1/normalize-data", files=[])
    assert response.status_code == 400


@patch("app.services.schema_inference_service.SchemaInferenceService._call_gemini_api")
@patch("app.services.ai_understanding_service.AIUnderstandingService._call_gemini_api")
def test_normalize_crm_json(mock_ai, mock_schema_ai):
    mock_ai.return_value = json.dumps({
        "entity_type": "organization",
        "normalized_data": {"name": "Acme Corporation"},
        "summary": "Company detected",
        "confidence_score": 0.95,
        "attributes": {"name": "Acme Corporation"}
    })

    mock_schema_ai.return_value = json.dumps({
        "dataset_type": "customer_contacts",
        "primary_entity": "person",
        "confidence_score": 0.95,
        "schema": [
            {"original_field": "cust_nm", "standardized_field": "name", "confidence": 0.98, "category": "person_attribute"},
            {"original_field": "mailid", "standardized_field": "email", "confidence": 0.93, "category": "contact_attribute"}
        ]
    })

    payload = {"records": [{"cust_nm": "Acme Corporation", "mailid": "sales@acme.com"}]}
    res = client.post("/api/v1/normalize-data", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["primary_entity"] == "person"
    assert any(f["standardized_field"] == "email" for f in body["schema"])
    assert "email" in body["confidence"]


@patch("app.services.schema_inference_service.SchemaInferenceService._call_gemini_api")
def test_normalize_partial_resume(mock_schema_ai):
    mock_schema_ai.return_value = json.dumps({
        "dataset_type": "candidate_resume",
        "primary_entity": "person",
        "confidence_score": 0.91,
        "schema": [
            {"original_field": "emp_name", "standardized_field": "name", "confidence": 0.95, "category": "person_attribute"},
            {"original_field": "yrs_exp", "standardized_field": "years_experience", "confidence": 0.88, "category": "experience"}
        ]
    })

    payload = {"emp_name": "Jane Doe", "dept": "Engineering", "yrs_exp": 5}
    res = client.post("/api/v1/normalize-data", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["dataset_type"] == "candidate_resume"
    assert any(f["original_field"] == "emp_name" for f in body["schema"]) 


@patch("app.services.parser_service.ParserService.parse")
@patch("app.services.schema_inference_service.SchemaInferenceService._call_gemini_api")
def test_normalize_invoice_file(mock_schema_ai, mock_parse):
    mock_schema_ai.return_value = json.dumps({
        "dataset_type": "invoice_data",
        "primary_entity": "invoice",
        "confidence_score": 0.92,
        "schema": [
            {"original_field": "inv_no", "standardized_field": "invoice_number", "confidence": 0.94, "category": "financial"},
            {"original_field": "amt_due", "standardized_field": "amount_due", "confidence": 0.93, "category": "financial"}
        ]
    })

    mock_parse.return_value = {"format": "csv", "columns": ["inv_no", "amt_due"], "sample": [{"inv_no": "INV-1001", "amt_due": "1234.56"}], "row_count": 1}

    csv_bytes = b"inv_no,amt_due\nINV-1001,1234.56\n"
    files = [("files", ("invoice.csv", io.BytesIO(csv_bytes), "text/csv"))]
    res = client.post("/api/v1/normalize-data", files=files)
    assert res.status_code == 200
    body = res.json()
    assert body["dataset_type"] == "invoice_data"
    assert any(f["standardized_field"] == "invoice_number" for f in body["schema"]) 
