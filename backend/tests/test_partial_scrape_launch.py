from __future__ import annotations

from datetime import datetime
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.demo_routes import _compute_next_refresh_at
from app.core.database import get_connection
from app.main import app
from app.services.wcm_comparison_service import get_review_rows


client = TestClient(app)


def test_partial_scrape_launch_creates_pending_onboarding_without_running_scraper():
    job_id = f"J-PS-{uuid4().hex[:10].upper()}"
    request_payload = {
        "jobs": [
            {
                "id": job_id,
                "source": "TurkeyBrokers",
                "scope": "Partial Scrape",
                "filters": "Pending Onboarding",
                "custom_criteria": "Find broker profiles that mention Texas and include their end URLs.",
                "end_urls": ["https://www.turkeybrokers.com/profiles", "https://www.turkeybrokers.com/search"],
                "prompt": "Track broker listings in Texas.",
                "files": [{"id": "upload-1", "filename": "onboarding-notes.pdf"}],
                "frequency": "One-time",
                "delivery": "S3 bucket",
                "output_format": "JSON",
                "isCustomSource": False,
                "mode": "By Source",
            }
        ]
    }

    with patch("app.api.demo_routes.execute_partial_scrape") as mock_execute_partial_scrape:
        response = client.post("/api/v1/demo/jobs/launch", json=request_payload)

    assert response.status_code == 200
    assert response.json()["launched_count"] == 1
    assert mock_execute_partial_scrape.call_count == 0

    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, planner_json, records, next_refresh FROM scraper_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()

    assert row is not None
    assert row[0] == "Pending Onboarding"
    assert row[1] is None
    assert row[2] == 0
    assert row[3] is None

    with get_connection() as conn:
        audit_row = conn.execute(
            "SELECT request_status, job_status, execution_metadata_json FROM admin_request_audit WHERE job_id = ?",
            (job_id,),
        ).fetchone()

    assert audit_row is not None
    assert audit_row[0] == "Pending Onboarding"
    assert audit_row[1] == "Pending Onboarding"
    assert '"source_kind": "Partial Scrape"' in audit_row[2]
    assert '"end_urls"' in audit_row[2]
    assert '"prompt"' in audit_row[2]

    review_rows = get_review_rows(job_id, 2.0)
    assert review_rows["rows"] == []
    assert review_rows["totalSampled"] == 0

    with get_connection() as conn:
        conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
        conn.commit()


def test_custom_scrape_launch_stays_by_source_pending_onboarding():
    job_id = f"J-CS-{uuid4().hex[:10].upper()}"
    request_payload = {
        "jobs": [
            {
                "id": job_id,
                "source": "GST by PAN",
                "scope": "Custom Scrape",
                "filters": "Pending Onboarding",
                "custom_criteria": "Only crawl pages with GST references and keep the supplied prompt.",
                "end_urls": ["https://example.com/gst"],
                "prompt": "Collect GST details with the attached file as guidance.",
                "files": [{"id": "upload-1", "filename": "guide.pdf"}],
                "frequency": "One-time",
                "delivery": "S3 bucket",
                "output_format": "JSON",
                "isCustomSource": False,
                "mode": "Site-Specific",
            }
        ]
    }

    with patch("app.api.demo_routes.execute_partial_scrape") as mock_execute_partial_scrape:
        response = client.post("/api/v1/demo/jobs/launch", json=request_payload)

    assert response.status_code == 200
    assert response.json()["launched_count"] == 1
    assert mock_execute_partial_scrape.call_count == 0

    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, scope, mode FROM scraper_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()

    assert row is not None
    assert row[0] == "Pending Onboarding"
    assert row[1] == "Custom Scrape"
    assert row[2] == "Site-Specific"

    with get_connection() as conn:
        audit_row = conn.execute(
            "SELECT request_type, request_status, job_status, execution_metadata_json FROM admin_request_audit WHERE job_id = ?",
            (job_id,),
        ).fetchone()

    assert audit_row is not None
    assert audit_row[0] == "By Source"
    assert audit_row[1] == "Pending Onboarding"
    assert audit_row[2] == "Pending Onboarding"
    assert '"source_kind": "Partial Scrape"' in audit_row[3]

    with get_connection() as conn:
        conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
        conn.commit()


def test_hourly_refresh_schedules_one_hour_ahead():
    now = datetime(2026, 7, 1, 10, 30, 0)
    next_refresh = _compute_next_refresh_at("Hourly", now)
    assert next_refresh == datetime(2026, 7, 1, 11, 30, 0)
