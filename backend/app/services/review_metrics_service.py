"""
Live review metrics derived from persisted review and audit tables.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Optional

from app.core.database import get_connection, init_db
from app.core.logger import setup_logger

logger = setup_logger(__name__)


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _is_today(value: Any, *, day_start: datetime, next_day_start: datetime) -> bool:
    parsed = _parse_timestamp(value)
    if not parsed:
        return False
    local_time = parsed.astimezone(day_start.tzinfo)
    return day_start <= local_time < next_day_start


class ReviewMetricsService:
    def __init__(self) -> None:
        init_db()

    def get_metrics(self) -> Dict[str, Any]:
        now_local = datetime.now().astimezone()
        day_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        next_day_start = day_start + timedelta(days=1)

        with get_connection() as conn:
            pending_review_rows = conn.execute(
                """
                SELECT
                    ri.dataset_id AS job_id,
                    ri.confidence
                FROM review_items ri
                WHERE ri.review_status = 'pending'
                """
            ).fetchall()
            pending_job_rows = conn.execute(
                """
                SELECT id AS job_id, is_urgent
                FROM scraper_jobs
                WHERE status IN ('Review Pending', 'Review')
                """
            ).fetchall()
            approved_rows = conn.execute(
                "SELECT review_id, approved_at FROM approved_records"
            ).fetchall()
            approved_audit_rows = conn.execute(
                """
                SELECT review_id, created_at
                FROM audit_events
                WHERE event_type = 'review_approved'
                """
            ).fetchall()
            auto_approved_rows = conn.execute(
                """
                SELECT created_at
                FROM audit_events
                WHERE approval_path = 'Auto Approved'
                """
            ).fetchall()
            rejected_rows = conn.execute(
                """
                SELECT id AS review_item_id, record_id, updated_at
                FROM review_items
                WHERE review_status = 'rejected'
                """
            ).fetchall()
            rejected_audit_rows = conn.execute(
                """
                SELECT review_id, record_id, created_at
                FROM audit_events
                WHERE event_type = 'review_rejected'
                """
            ).fetchall()
            manual_review_rows = conn.execute(
                """
                SELECT created_at
                FROM audit_events
                WHERE event_type = 'review_approved'
                """
            ).fetchall()
            pending_confidence_rows = conn.execute(
                """
                SELECT metadata_json
                FROM audit_events
                WHERE event_type = 'record_processed'
                  AND approval_path IN ('Needs Review', 'Review Pending', 'review_queue')
                """
            ).fetchall()

        pending_ids = {str(row["job_id"]) for row in pending_review_rows if row["job_id"]}
        pending_ids.update(str(row["job_id"]) for row in pending_job_rows if row["job_id"])

        pending_total = len(pending_ids)
        pending_urgent = sum(
            1
            for row in pending_job_rows
            if row["job_id"] and str(row["job_id"]) in pending_ids and int(row["is_urgent"] or 0) == 1
        )

        confidences = [float(row["confidence"] or 0) for row in pending_review_rows if row["confidence"] is not None]
        if not confidences and pending_confidence_rows:
            for row in pending_confidence_rows:
                try:
                    payload = json.loads(row["metadata_json"] or "{}")
                except Exception:
                    payload = {}
                confidence = payload.get("confidence")
                if confidence is not None:
                    try:
                        confidences.append(float(confidence))
                    except Exception:
                        continue
        avg_confidence = round(sum(confidences) / len(confidences)) if confidences else 0

        approved_today_manual_ids = set()
        for row in approved_rows:
            if _is_today(row["approved_at"], day_start=day_start, next_day_start=next_day_start):
                approved_today_manual_ids.add(str(row["review_id"] or f"approved:{row['approved_at']}"))
        for row in approved_audit_rows:
            if _is_today(row["created_at"], day_start=day_start, next_day_start=next_day_start):
                approved_today_manual_ids.add(str(row["review_id"] or f"audit:{row['created_at']}"))
        approved_today_manual = len(approved_today_manual_ids)
        approved_today_auto = sum(
            1 for row in auto_approved_rows if _is_today(row["created_at"], day_start=day_start, next_day_start=next_day_start)
        )
        rejected_today_ids = set()
        for row in rejected_rows:
            if _is_today(row["updated_at"], day_start=day_start, next_day_start=next_day_start):
                rejected_today_ids.add(str(row["record_id"] or row["review_item_id"]))
        for row in rejected_audit_rows:
            if _is_today(row["created_at"], day_start=day_start, next_day_start=next_day_start):
                rejected_today_ids.add(str(row["record_id"] or row["review_id"]))
        rejected_today = len(rejected_today_ids)

        metrics = {
            "pending": pending_total,
            "pending_urgent": pending_urgent,
            "approved_today": approved_today_manual + approved_today_auto,
            "approved_today_manual": approved_today_manual,
            "approved_today_auto": approved_today_auto,
            "rejected_today": rejected_today,
            "avg_confidence": avg_confidence,
            "day_start": day_start.isoformat(),
            "next_day_start": next_day_start.isoformat(),
        }
        return metrics


review_metrics_service = ReviewMetricsService()
