import io
import json
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

@patch("app.services.schema_inference_service.SchemaInferenceService._call_gemini_api")
def test_infer_schema_from_crm_json(mock_call):
    mock_call.return_value = json.dumps({
        "dataset_type": "customer_contacts",
        "primary_entity": "person",
        "confidence_score": 0.95,
        "schema": [
            {
                "original_field": "cust_nm",
                "standardized_field": "customer_name",
                "confidence": 0.98,
                "category": "person_attribute",
                "reason": "Common CRM abbreviation for customer name"
            },
            {
                "original_field": "ph_no",
                "standardized_field": "phone_number",
                "confidence": 0.92,
                "category": "contact_attribute",
                "reason": "Common phone number abbreviation"
            },
            {
                "original_field": "mailid",
                "standardized_field": "email",
                "confidence": 0.93,
                "category": "contact_attribute",
                "reason": "Common email alias in CRM datasets"
            }
        ]
    })

    payload = {
        "records": [
            {"cust_nm": "Acme Corporation", "ph_no": "555-1234", "mailid": "sales@acme.com"}
        ]
    }

    response = client.post("/api/v1/infer-schema", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["dataset_type"] == "customer_contacts"
    assert body["primary_entity"] == "person"
    assert any(item["standardized_field"] == "customer_name" for item in body["schema"])

@patch("app.services.schema_inference_service.SchemaInferenceService._call_gemini_api")
def test_infer_schema_from_partial_resume_record(mock_call):
    mock_call.return_value = json.dumps({
        "dataset_type": "candidate_resume",
        "primary_entity": "person",
        "confidence_score": 0.91,
        "schema": [
            {
                "original_field": "emp_name",
                "standardized_field": "employee_name",
                "confidence": 0.95,
                "category": "person_attribute",
                "reason": "Common resume field for employee name"
            },
            {
                "original_field": "yrs_exp",
                "standardized_field": "years_experience",
                "confidence": 0.88,
                "category": "experience",
                "reason": "Likely years of experience in resume data"
            }
        ]
    })

    payload = {"emp_name": "Jane Doe", "dept": "Engineering", "yrs_exp": 5}
    response = client.post("/api/v1/infer-schema", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["dataset_type"] == "candidate_resume"
    assert any(field["original_field"] == "emp_name" for field in body["schema"])

@patch("app.services.schema_inference_service.SchemaInferenceService._call_gemini_api")
def test_infer_schema_from_invoice_csv_upload(mock_call):
    mock_call.return_value = json.dumps({
        "dataset_type": "invoice_data",
        "primary_entity": "invoice",
        "confidence_score": 0.92,
        "schema": [
            {
                "original_field": "inv_no",
                "standardized_field": "invoice_number",
                "confidence": 0.94,
                "category": "financial",
                "reason": "Common invoice identifier abbreviation"
            },
            {
                "original_field": "amt_due",
                "standardized_field": "amount_due",
                "confidence": 0.93,
                "category": "financial",
                "reason": "Amount due is a common invoice amount field"
            },
            {
                "original_field": "due_dt",
                "standardized_field": "due_date",
                "confidence": 0.91,
                "category": "temporal",
                "reason": "Common due date abbreviation"
            }
        ]
    })

    csv_bytes = b"inv_no,amt_due,due_dt\nINV-1001,1234.56,2026-06-30\n"
    files = {"file": ("invoice.csv", io.BytesIO(csv_bytes), "text/csv")}

    response = client.post("/api/v1/infer-schema", files=files)
    assert response.status_code == 200
    body = response.json()
    assert body["dataset_type"] == "invoice_data"
    assert any(item["standardized_field"] == "invoice_number" for item in body["schema"])

@patch("app.services.schema_inference_service.SchemaInferenceService._call_gemini_api")
def test_infer_schema_from_abbreviated_fields(mock_call):
    mock_call.return_value = json.dumps({
        "dataset_type": "supplier_records",
        "primary_entity": "organization",
        "confidence_score": 0.89,
        "schema": [
            {
                "original_field": "org",
                "standardized_field": "organization",
                "confidence": 0.92,
                "category": "organization",
                "reason": "Short form for organization"
            },
            {
                "original_field": "ph_no",
                "standardized_field": "phone_number",
                "confidence": 0.90,
                "category": "contact_attribute",
                "reason": "Common abbreviation for phone number"
            }
        ]
    })

    payload = {"records": [{"org": "Acme Supplies", "ph_no": "555-9876"}]}
    response = client.post("/api/v1/infer-schema", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["dataset_type"] == "supplier_records"
    assert any(field["original_field"] == "org" for field in body["schema"])
