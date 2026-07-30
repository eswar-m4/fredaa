from __future__ import annotations

from datetime import datetime, timedelta
import os
import sys

from fastapi.testclient import TestClient

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from app.core.database import get_connection
from app.main import app


client = TestClient(app)


def _cleanup(job_ids: list[str]) -> None:
    with get_connection() as conn:
        for job_id in job_ids:
            conn.execute("DELETE FROM review_items WHERE dataset_id = ?", (job_id,))
            conn.execute("DELETE FROM approved_records WHERE dataset_id = ?", (job_id,))
            conn.execute("DELETE FROM audit_events WHERE dataset_id = ?", (job_id,))
            conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
        conn.commit()


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def test_review_metrics_reflect_persisted_counts_and_urgent_jobs():
    urgent_job_id = "test-review-metrics-urgent"
    normal_job_id = "test-review-metrics-normal"
    now_local = datetime.now().astimezone().replace(microsecond=0)
    yesterday_local = now_local - timedelta(days=1)

    _cleanup([urgent_job_id, normal_job_id])

    baseline_response = client.get("/api/v1/workflows/review-metrics")
    assert baseline_response.status_code == 200
    baseline = baseline_response.json()["metrics"]

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO scraper_jobs (
                id, source, scope, filters, custom_criteria, frequency, delivery,
                output_format, dataset_path, status, records, fresh, created_at,
                refresh_count, is_custom_source, mode, is_urgent
            ) VALUES (?, ?, 'Full Dump', '—', '—', 'Weekly', 'S3 bucket',
                      'JSON', '', 'Review Pending', 0, 100, ?, 0, 1, 'Site-Specific', 1)
            """,
            (urgent_job_id, "Urgent Source", _iso(now_local)),
        )
        conn.execute(
            """
            INSERT INTO scraper_jobs (
                id, source, scope, filters, custom_criteria, frequency, delivery,
                output_format, dataset_path, status, records, fresh, created_at,
                refresh_count, is_custom_source, mode, is_urgent
            ) VALUES (?, ?, 'Full Dump', '—', '—', 'Weekly', 'S3 bucket',
                      'JSON', '', 'Review Pending', 0, 100, ?, 0, 1, 'Site-Specific', 0)
            """,
            (normal_job_id, "Normal Source", _iso(now_local)),
        )

        conn.execute(
            """
            INSERT INTO review_items (
                id, record_id, dataset_id, dataset_name, company, confidence,
                review_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            """,
            (
                "review-pending-urgent",
                "record-urgent",
                urgent_job_id,
                "Urgent Source",
                "Urgent Co",
                80,
                _iso(now_local),
                _iso(now_local),
            ),
        )
        conn.execute(
            """
            INSERT INTO review_items (
                id, record_id, dataset_id, dataset_name, company, confidence,
                review_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            """,
            (
                "review-pending-normal",
                "record-normal",
                normal_job_id,
                "Normal Source",
                "Normal Co",
                60,
                _iso(now_local),
                _iso(now_local),
            ),
        )
        conn.execute(
            """
            INSERT INTO review_items (
                id, record_id, dataset_id, dataset_name, company, confidence,
                review_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'rejected', ?, ?)
            """,
            (
                "review-rejected-today",
                "record-rejected-today",
                urgent_job_id,
                "Urgent Source",
                "Rejected Today Co",
                55,
                _iso(now_local),
                _iso(now_local),
            ),
        )
        conn.execute(
            """
            INSERT INTO review_items (
                id, record_id, dataset_id, dataset_name, company, confidence,
                review_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'rejected', ?, ?)
            """,
            (
                "review-rejected-yesterday",
                "record-rejected-yesterday",
                normal_job_id,
                "Normal Source",
                "Rejected Yesterday Co",
                40,
                _iso(yesterday_local),
                _iso(yesterday_local),
            ),
        )
        conn.execute(
            """
            INSERT INTO approved_records (
                id, review_id, dataset_id, company, approved_values_json,
                discovered_website, confidence, approved_at
            ) VALUES (?, ?, ?, ?, '[]', '', ?, ?)
            """,
            (
                "approved-today",
                "review-approval-today",
                urgent_job_id,
                "Approved Today Co",
                88,
                _iso(now_local),
            ),
        )
        conn.execute(
            """
            INSERT INTO approved_records (
                id, review_id, dataset_id, company, approved_values_json,
                discovered_website, confidence, approved_at
            ) VALUES (?, ?, ?, ?, '[]', '', ?, ?)
            """,
            (
                "approved-yesterday",
                "review-approval-yesterday",
                normal_job_id,
                "Approved Yesterday Co",
                91,
                _iso(yesterday_local),
            ),
        )
        conn.execute(
            """
            INSERT INTO audit_events (
                id, event_type, dataset_id, record_id, review_id, company,
                original_values_json, discovered_values_json, changed_fields_json,
                approval_path, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', '[]', ?, '[]', ?)
            """,
            (
                "audit-auto-today",
                "record_processed",
                urgent_job_id,
                "record-auto-today",
                "review-auto-today",
                "Auto Today Co",
                "Auto Approved",
                _iso(now_local),
            ),
        )
        conn.execute(
            """
            INSERT INTO audit_events (
                id, event_type, dataset_id, record_id, review_id, company,
                original_values_json, discovered_values_json, changed_fields_json,
                approval_path, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', '[]', ?, '[]', ?)
            """,
            (
                "audit-auto-yesterday",
                "record_processed",
                normal_job_id,
                "record-auto-yesterday",
                "review-auto-yesterday",
                "Auto Yesterday Co",
                "Auto Approved",
                _iso(yesterday_local),
            ),
        )
        conn.commit()

    try:
        response = client.get("/api/v1/workflows/review-metrics")
        assert response.status_code == 200
        metrics = response.json()["metrics"]

        assert metrics["pending"] == baseline["pending"] + 2
        assert metrics["pending_urgent"] == baseline["pending_urgent"] + 1
        assert metrics["approved_today"] == baseline["approved_today"] + 2
        assert metrics["approved_today_manual"] == baseline["approved_today_manual"] + 1
        assert metrics["approved_today_auto"] == baseline["approved_today_auto"] + 1
        assert metrics["rejected_today"] == baseline["rejected_today"] + 1
        assert metrics["avg_confidence"] == 70
    finally:
        _cleanup([urgent_job_id, normal_job_id])


def test_monitoring_urgent_toggle_persists():
    job_id = "test-monitoring-urgent-toggle"
    now_local = datetime.now().astimezone().replace(microsecond=0)

    _cleanup([job_id])

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO scraper_jobs (
                id, source, scope, filters, custom_criteria, frequency, delivery,
                output_format, dataset_path, status, records, fresh, created_at,
                refresh_count, is_custom_source, mode, is_urgent
            ) VALUES (?, ?, 'Full Dump', '—', '—', 'Weekly', 'S3 bucket',
                      'JSON', '', 'Running', 0, 100, ?, 0, 1, 'Site-Specific', 0)
            """,
            (job_id, "Urgent Toggle Source", _iso(now_local)),
        )
        conn.commit()

    try:
        response = client.post(f"/api/v1/demo/jobs/{job_id}/urgent", json={"is_urgent": True})
        assert response.status_code == 200
        assert response.json()["is_urgent"] is True

        with get_connection() as conn:
            row = conn.execute("SELECT is_urgent FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
        assert row is not None
        assert row["is_urgent"] == 1

        jobs_response = client.get("/api/v1/demo/jobs")
        assert jobs_response.status_code == 200
        job = next((item for item in jobs_response.json() if item["id"] == job_id), None)
        assert job is not None
        assert job["is_urgent"] is True
    finally:
        _cleanup([job_id])
