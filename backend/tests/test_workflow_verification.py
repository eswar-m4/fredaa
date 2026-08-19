"""
Workflow verification tests (mocked network where needed).
"""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient

from app.main import app
from app.services.organization_url_service import resolve_organization_url_candidates
from app.services.review_service import review_service
from app.services.workflow_service import workflow_service

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_review_queue():
    review_service.clear()
    yield
    review_service.clear()


OPENAI_METADATA = {
    "url": "https://openai.com",
    "title": "OpenAI",
    "meta_description": "OpenAI researches AI",
    "detected_company_name": "OpenAI",
    "page_text": "OpenAI is an AI research company",
    "emails": ["contact@openai.com"],
    "phone_numbers": [],
    "social_links": ["https://linkedin.com/company/openai"],
    "detected_keywords": ["openai", "research"],
}

TESLA_METADATA = {
    "url": "https://www.tesla.com",
    "title": "Tesla",
    "meta_description": "Electric vehicles and clean energy",
    "detected_company_name": "Tesla",
    "page_text": "Tesla designs electric vehicles",
    "emails": [],
    "phone_numbers": [],
    "social_links": [],
    "detected_keywords": ["tesla", "electric"],
}

FAKE_CANDIDATES = [
    {"url": "https://fake-test-company.net", "domain": "fake-test-company.net", "title": "Fake Test", "snippet": "unrelated"},
    {"url": "https://example.org", "domain": "example.org", "title": "Example", "snippet": "generic"},
]


@patch("app.services.company_verification_service.fetch_website_metadata", new_callable=AsyncMock)
def test_verify_record_openai_with_website(mock_fetch):
    mock_fetch.return_value = OPENAI_METADATA

    response = client.post(
        "/api/v1/workflows/verify-record",
        json={
            "record": {"company": "OpenAI", "website": "openai.com"},
            "config": {"autoApproveThreshold": 75, "reviewThreshold": 60},
        },
    )
    assert response.status_code == 200
    data = response.json()["result"]
    assert data["status"] == "Auto Approved"
    assert data["confidence"] >= 75
    assert "openai" in (data.get("website") or "").lower()


@patch("app.services.company_verification_service.fetch_website_metadata", new_callable=AsyncMock)
@patch(
    "app.services.company_verification_service.website_discovery_service.discover",
    new_callable=AsyncMock,
)
def test_verify_record_tesla_discovery(mock_discover, mock_fetch):
    mock_discover.return_value = [
        {"url": "https://www.tesla.com", "domain": "tesla.com", "title": "Tesla", "snippet": "Electric cars"},
        {"url": "https://tesla.org", "domain": "tesla.org", "title": "Tesla fans", "snippet": "community"},
    ]

    async def fetch_side_effect(url):
        if "tesla.org" in (url or ""):
            return {
                **TESLA_METADATA,
                "url": "https://tesla.org",
                "title": "Tesla Community",
                "page_text": "fan community",
                "detected_company_name": "Tesla fans",
            }
        return TESLA_METADATA

    mock_fetch.side_effect = fetch_side_effect

    response = client.post(
        "/api/v1/workflows/verify-record",
        json={
            "record": {"company": "Tesla", "website": None},
            "config": {"autoApproveThreshold": 75, "reviewThreshold": 60},
        },
    )
    assert response.status_code == 200
    data = response.json()["result"]
    assert data["discovery_used"] is True
    assert data["status"] == "Auto Approved"
    assert "tesla" in (data.get("website") or "").lower()


@patch(
    "app.services.company_verification_service.website_discovery_service.discover",
    new_callable=AsyncMock,
)
def test_verify_record_fake_company_review(mock_discover):
    mock_discover.return_value = FAKE_CANDIDATES

    response = client.post(
        "/api/v1/workflows/verify-record",
        json={
            "record": {"company": "Fake Test Company", "website": None},
            "config": {"autoApproveThreshold": 75, "reviewThreshold": 60},
        },
    )
    assert response.status_code == 200
    data = response.json()["result"]
    assert data["status"] in ("Needs Review", "Partially Verified", "Verification Failed")
    assert len(data.get("website_candidates") or []) >= 1


@patch("app.services.company_verification_service.fetch_website_metadata", new_callable=AsyncMock)
@patch("app.services.company_verification_service.website_discovery_service.discover", new_callable=AsyncMock)
def test_verify_record_uses_hardcoded_org_url_when_website_missing(mock_discover, mock_fetch):
    expected_url = resolve_organization_url_candidates({"company": "StudyCorgi"})[0]
    mock_discover.return_value = []
    mock_fetch.return_value = {**OPENAI_METADATA, "url": expected_url}

    response = client.post(
        "/api/v1/workflows/verify-record",
        json={
            "record": {
                "company": "StudyCorgi",
            },
            "config": {"autoApproveThreshold": 75, "reviewThreshold": 60},
        },
    )

    assert response.status_code == 200
    data = response.json()["result"]
    assert mock_discover.await_count == 0
    assert mock_fetch.await_count == 1
    assert mock_fetch.await_args.args[0] == expected_url
    assert data.get("website") == expected_url


@patch("app.services.company_verification_service.fetch_website_metadata", new_callable=AsyncMock)
def test_workflow_run_review_queue_structure(mock_fetch):
    mock_fetch.return_value = OPENAI_METADATA

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "workflowConfig": {"selectedWorkflows": ["Website Verification"], "autoApproveThreshold": 99, "reviewThreshold": 60},
            "dataset": {
                "id": "ds_hospital",
                "name": "Hospital_ER_Data.csv",
                "records": [
                    {"company": "OpenAI", "website": "openai.com"},
                    {"company": "Weak Co", "website": "unknown-site.xyz"},
                ],
            },
        },
    )
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert "review_queue" in summary
    assert "level_1_datasets" in summary["review_queue"]
    assert summary["review_queue"]["level_1_datasets"][0]["dataset_name"] == "Hospital_ER_Data.csv"


def test_company_website_enabled_for_priority_sources():
    config = {
        "selectedWorkflows": ["Website Verification"],
        "prioritySources": ["SEC/MCA", "LinkedIn"],
    }

    assert workflow_service._company_website_enabled(config) is True
