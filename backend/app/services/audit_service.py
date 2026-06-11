"""
Lightweight audit trail for enterprise workflow traceability.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from app.core.database import get_connection, init_db, json_dumps, json_loads
from app.core.logger import setup_logger

logger = setup_logger(__name__)


class AuditService:
    def __init__(self) -> None:
        init_db()

    def log_event(
        self,
        *,
        event_type: str,
        dataset_id: Optional[str] = None,
        record_id: Optional[str] = None,
        review_id: Optional[str] = None,
        company: Optional[str] = None,
        original_values: Optional[Dict[str, Any]] = None,
        discovered_values: Optional[Dict[str, Any]] = None,
        changed_fields: Optional[List[str]] = None,
        approval_path: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        entry = {
            "id": f"audit_{uuid4().hex[:12]}",
            "event_type": event_type,
            "dataset_id": dataset_id,
            "record_id": record_id,
            "review_id": review_id,
            "company": company,
            "original_values": original_values or {},
            "discovered_values": discovered_values or {},
            "changed_fields": changed_fields or [],
            "approval_path": approval_path,
            "metadata": metadata or {},
            "created_at": datetime.utcnow().isoformat(),
        }
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO audit_events (
                    id, event_type, dataset_id, record_id, review_id, company,
                    original_values_json, discovered_values_json, changed_fields_json,
                    approval_path, metadata_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry["id"],
                    entry["event_type"],
                    entry["dataset_id"],
                    entry["record_id"],
                    entry["review_id"],
                    entry["company"],
                    json_dumps(entry["original_values"]),
                    json_dumps(entry["discovered_values"]),
                    json_dumps(entry["changed_fields"]),
                    entry["approval_path"],
                    json_dumps(entry["metadata"]),
                    entry["created_at"],
                ),
            )
            conn.commit()
        logger.info("[Audit] %s for %s", event_type, company or record_id)
        return entry

    def list_events(
        self,
        *,
        dataset_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        query = "SELECT * FROM audit_events"
        params: List[Any] = []
        if dataset_id:
            query += " WHERE dataset_id = ?"
            params.append(dataset_id)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        with get_connection() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def _row_to_dict(self, row: Any) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "event_type": row["event_type"],
            "dataset_id": row["dataset_id"],
            "record_id": row["record_id"],
            "review_id": row["review_id"],
            "company": row["company"],
            "original_values": json_loads(row["original_values_json"]),
            "discovered_values": json_loads(row["discovered_values_json"]),
            "changed_fields": json_loads(row["changed_fields_json"], []),
            "approval_path": row["approval_path"],
            "metadata": json_loads(row["metadata_json"]),
            "created_at": row["created_at"],
        }


audit_service = AuditService()
