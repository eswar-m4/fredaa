"""
Persistent review queue (SQLite) with dataset-level and record-level structure.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from app.core.database import get_connection, init_db, json_dumps, json_loads
from app.core.logger import setup_logger

logger = setup_logger(__name__)

REVIEW_STATUSES = {"pending", "approved", "rejected", "edited"}


class ReviewService:
    def __init__(self) -> None:
        init_db()

    def create_review(
        self,
        dataset_id: str,
        company: str,
        confidence: int,
        reasons: List[str],
        suggested_changes: Dict[str, Any],
        sources_checked: List[Dict[str, Any]],
        *,
        dataset_name: Optional[str] = None,
        record_id: Optional[str] = None,
        field_comparisons: Optional[List[Dict[str, Any]]] = None,
        source_website: Optional[str] = None,
        website_candidates: Optional[List[Dict[str, Any]]] = None,
        uploaded_row: Optional[Dict[str, Any]] = None,
        scraped_metadata: Optional[Dict[str, Any]] = None,
        comparison: Optional[Dict[str, Any]] = None,
        confidence_reasons: Optional[List[str]] = None,
        ambiguous_candidates: bool = False,
    ) -> Dict[str, Any]:
        record_id = record_id or f"record_{uuid4().hex[:10]}"
        review_id = f"review_{uuid4().hex[:10]}"
        now = datetime.utcnow().isoformat()
        entry = {
            "id": review_id,
            "record_id": record_id,
            "dataset_id": dataset_id,
            "dataset_name": dataset_name or dataset_id,
            "company": company,
            "confidence": confidence,
            "reasons": [r for r in reasons if r],
            "review_reason": "; ".join([r for r in reasons if r]),
            "suggested_changes": suggested_changes,
            "sources_checked": sources_checked,
            "field_comparisons": field_comparisons or [],
            "source_website": source_website,
            "website_candidates": website_candidates or [],
            "uploaded_row": uploaded_row or {},
            "scraped_metadata": scraped_metadata or {},
            "comparison": comparison or {},
            "confidence_reasons": confidence_reasons or [],
            "ambiguous_candidates": ambiguous_candidates,
            "review_status": "pending",
            "decision": "pending",
            "timestamp": now,
            "created_at": now,
            "updated_at": now,
        }
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM review_items WHERE dataset_id = ? AND record_id = ? AND review_status = ?",
                (dataset_id, record_id, "pending"),
            )
            conn.execute(
                """
                INSERT INTO review_items (
                    id, record_id, dataset_id, dataset_name, company, confidence,
                    review_status, review_reason, uploaded_row_json, scraped_metadata_json,
                    comparison_json, discovered_website, website_candidates_json,
                    confidence_reasons_json, field_comparisons_json, suggested_changes_json,
                    sources_checked_json, edited_values_json, ambiguous_candidates,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry["id"],
                    entry["record_id"],
                    entry["dataset_id"],
                    entry["dataset_name"],
                    entry["company"],
                    entry["confidence"],
                    entry["review_status"],
                    entry["review_reason"],
                    json_dumps(entry["uploaded_row"]),
                    json_dumps(entry["scraped_metadata"]),
                    json_dumps(entry["comparison"]),
                    entry["source_website"],
                    json_dumps(entry["website_candidates"]),
                    json_dumps(entry["confidence_reasons"]),
                    json_dumps(entry["field_comparisons"]),
                    json_dumps(entry["suggested_changes"]),
                    json_dumps(entry["sources_checked"]),
                    json_dumps({}),
                    1 if ambiguous_candidates else 0,
                    entry["created_at"],
                    entry["updated_at"],
                ),
            )
            conn.commit()
        logger.info("[Review Queue Routing] created review %s for %s", review_id, company)
        return entry

    def get_review(self, review_id: str) -> Optional[Dict[str, Any]]:
        with get_connection() as conn:
            row = conn.execute("SELECT * FROM review_items WHERE id = ?", (review_id,)).fetchone()
        if not row:
            return None
        return self._row_to_entry(row)

    def list_reviews(
        self,
        dataset_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        query = "SELECT * FROM review_items WHERE 1=1"
        params: List[Any] = []
        if dataset_id:
            query += " AND dataset_id = ?"
            params.append(dataset_id)
        if status:
            query += " AND review_status = ?"
            params.append(status)
        query += " ORDER BY created_at DESC"
        with get_connection() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_entry(row) for row in rows]

    def approve_review(
        self,
        review_id: str,
        *,
        approved_values: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        item = self.get_review(review_id)
        if not item:
            raise ValueError("Review item not found")
        now = datetime.utcnow().isoformat()
        values = approved_values or item.get("suggested_changes") or {}
        with get_connection() as conn:
            conn.execute(
                "UPDATE review_items SET review_status = ?, updated_at = ? WHERE id = ?",
                ("approved", now, review_id),
            )
            approved_id = f"approved_{uuid4().hex[:10]}"
            conn.execute(
                """
                INSERT INTO approved_records (
                    id, review_id, dataset_id, company, approved_values_json,
                    discovered_website, confidence, approved_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    approved_id,
                    review_id,
                    item["dataset_id"],
                    item["company"],
                    json_dumps(values),
                    item.get("source_website"),
                    item.get("confidence"),
                    now,
                ),
            )
            conn.commit()
        item["review_status"] = "approved"
        item["decision"] = "approved"
        item["updated_at"] = now
        item["approved_record_id"] = approved_id
        return item

    def reject_review(self, review_id: str, *, reason: Optional[str] = None) -> Dict[str, Any]:
        item = self.get_review(review_id)
        if not item:
            raise ValueError("Review item not found")
        now = datetime.utcnow().isoformat()
        with get_connection() as conn:
            conn.execute(
                "UPDATE review_items SET review_status = ?, review_reason = ?, updated_at = ? WHERE id = ?",
                ("rejected", reason or item.get("review_reason"), now, review_id),
            )
            conn.commit()
        item["review_status"] = "rejected"
        item["decision"] = "rejected"
        item["updated_at"] = now
        return item

    def edit_review(
        self,
        review_id: str,
        corrected_values: Dict[str, Any],
    ) -> Dict[str, Any]:
        item = self.get_review(review_id)
        if not item:
            raise ValueError("Review item not found")
        now = datetime.utcnow().isoformat()
        with get_connection() as conn:
            conn.execute(
                """
                UPDATE review_items
                SET review_status = ?, edited_values_json = ?, updated_at = ?
                WHERE id = ?
                """,
                ("edited", json_dumps(corrected_values), now, review_id),
            )
            conn.commit()
        item["review_status"] = "edited"
        item["decision"] = "edited"
        item["edited_values"] = corrected_values
        item["updated_at"] = now
        return item

    def get_review_queue(self, dataset_id: Optional[str] = None) -> Dict[str, Any]:
        items = self.list_reviews(dataset_id=dataset_id, status="pending")
        datasets: Dict[str, Dict[str, Any]] = {}
        for item in items:
            ds = datasets.setdefault(
                item["dataset_id"],
                {
                    "dataset_id": item["dataset_id"],
                    "dataset_name": item["dataset_name"],
                    "pending_review_count": 0,
                    "records": [],
                },
            )
            ds["records"].append(self._summary_record(item))
            ds["pending_review_count"] = len(ds["records"])

        level_1 = sorted(datasets.values(), key=lambda x: x["dataset_name"])
        level_2 = {d["dataset_id"]: d["records"] for d in level_1}

        if dataset_id:
            bucket = datasets.get(dataset_id)
            return {
                "level_1_datasets": [
                    {
                        "dataset_id": bucket["dataset_id"],
                        "dataset_name": bucket["dataset_name"],
                        "pending_review_count": bucket["pending_review_count"],
                    }
                ]
                if bucket
                else [],
                "level_2_records": level_2,
                "total_pending": bucket["pending_review_count"] if bucket else 0,
            }

        return {
            "level_1_datasets": [
                {
                    "dataset_id": d["dataset_id"],
                    "dataset_name": d["dataset_name"],
                    "pending_review_count": d["pending_review_count"],
                }
                for d in level_1
            ],
            "level_2_records": level_2,
            "total_pending": sum(d["pending_review_count"] for d in level_1),
        }

    def clear(self) -> None:
        """Test helper — clears persistent queue tables."""
        with get_connection() as conn:
            conn.execute("DELETE FROM review_items")
            conn.execute("DELETE FROM approved_records")
            conn.execute("DELETE FROM audit_events")
            conn.commit()

    def _summary_record(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "review_id": item["id"],
            "record_id": item["record_id"],
            "company": item["company"],
            "confidence": item["confidence"],
            "decision": item.get("decision"),
            "review_status": item.get("review_status"),
            "source_website": item.get("source_website"),
            "field_comparisons": item.get("field_comparisons") or [],
            "website_candidates": item.get("website_candidates") or [],
            "confidence_reasons": item.get("confidence_reasons") or [],
            "ambiguous_candidates": item.get("ambiguous_candidates"),
        }

    def _row_to_entry(self, row: Any) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "record_id": row["record_id"],
            "dataset_id": row["dataset_id"],
            "dataset_name": row["dataset_name"],
            "company": row["company"],
            "confidence": row["confidence"],
            "reasons": [row["review_reason"]] if row["review_reason"] else [],
            "review_reason": row["review_reason"],
            "suggested_changes": json_loads(row["suggested_changes_json"]),
            "sources_checked": json_loads(row["sources_checked_json"], []),
            "field_comparisons": json_loads(row["field_comparisons_json"], []),
            "source_website": row["discovered_website"],
            "website_candidates": json_loads(row["website_candidates_json"], []),
            "uploaded_row": json_loads(row["uploaded_row_json"]),
            "scraped_metadata": json_loads(row["scraped_metadata_json"]),
            "comparison": json_loads(row["comparison_json"]),
            "confidence_reasons": json_loads(row["confidence_reasons_json"], []),
            "ambiguous_candidates": bool(row["ambiguous_candidates"]),
            "review_status": row["review_status"],
            "decision": row["review_status"],
            "edited_values": json_loads(row["edited_values_json"]),
            "timestamp": row["created_at"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }


review_service = ReviewService()
