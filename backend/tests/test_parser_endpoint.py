import io
import pytest
import pandas as pd
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app.api.demo_routes import _is_partial_scope
client = TestClient(app)


def test_parse_file_csv():
    # 1. Create a dummy CSV file in memory
    csv_data = "phone_number,email_address,city\n+15550199,info@acme.com,New York\n"
    file_payload = ("test.csv", csv_data.encode("utf-8"), "text/csv")
    
    # 2. Call the parse-file endpoint
    response = client.post(
        "/api/v1/workflows/parse-file",
        files={"file": file_payload}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["format"] == "csv"
    assert data["row_count"] == 1
    assert data["columns"] == ["phone_number", "email_address", "city"]
    assert len(data["records"]) == 1
    assert data["records"][0]["phone_number"] == "+15550199"


def test_parse_file_xlsx():
    # 1. Create a dummy Excel file in memory using pandas
    df = pd.DataFrame([{"telephone": "+123456", "domain": "acme.com"}])
    excel_io = io.BytesIO()
    df.to_excel(excel_io, index=False)
    excel_io.seek(0)
    
    file_payload = ("test.xlsx", excel_io.read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    
    # 2. Call the parse-file endpoint
    response = client.post(
        "/api/v1/workflows/parse-file",
        files={"file": file_payload}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["format"] == "xlsx"
    assert data["row_count"] == 1
    assert "telephone" in data["columns"]
    assert data["records"][0]["telephone"] == "+123456"


def test_by_dataset_scope_is_not_treated_as_partial_scope():
    assert _is_partial_scope("By Dataset") is False
    assert _is_partial_scope("Custom Dump") is True


def test_by_dataset_launch_does_not_route_into_partial_planner(monkeypatch):
    from app.api import demo_routes

    monkeypatch.setattr(demo_routes, "run_scraper_background", lambda *args, **kwargs: None)

    with patch(
        "app.services.openai_cde_service.openai_cde_service.extract_dataset_data",
        new_callable=AsyncMock,
        return_value=[{"entity": "Acme Inc.", "extracted": {}}],
    ):
        response = client.post(
            "/api/v1/demo/jobs/launch",
            json={
                "jobs": [
                    {
                        "id": "J-TEST-BY-DATASET",
                        "source": "Firmographic Data",
                        "scope": "By Dataset",
                        "filters": "{\"selectedOutputs\":[\"legal_name\"],\"seedFile\":\"sample.csv\"}",
                        "frequency": "Monthly",
                        "delivery": "S3 bucket",
                        "output_format": "JSON",
                        "isCustomSource": False,
                        "mode": "By Dataset",
                        "input_data": [{"company_name": "Acme Inc."}],
                    }
                ]
            },
        )

    assert response.status_code == 200
