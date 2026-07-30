"""
Audit ledger for user-submitted workflow requests shown in the admin console.
"""

from __future__ import annotations

import json
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from app.core.database import get_connection, init_db, json_dumps, json_loads
from app.core.logger import setup_logger

logger = setup_logger(__name__)


def _now() -> str:
    return datetime.utcnow().isoformat()


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", ""))
    except Exception:
        return None


class AdminRequestAuditService:
    def __init__(self) -> None:
        init_db()

    @staticmethod
    def _backend_root() -> Path:
        return Path(__file__).resolve().parents[2]

    def _load_job_input_data(self, job_id: str) -> Any:
        input_path = self._backend_root() / "datasets" / f"{job_id}_input.json"
        if not input_path.exists():
            return None
        try:
            with input_path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except Exception:
            return None

    def _resolve_display_name(self, username: Optional[str], fallback: Optional[str] = None) -> str:
        username_text = str(username or "").strip()
        if not username_text:
            return str(fallback or "").strip()
        try:
            with get_connection() as conn:
                row = conn.execute(
                    "SELECT display_name FROM auth_users WHERE username = ? LIMIT 1",
                    (username_text,),
                ).fetchone()
        except Exception:
            row = None
        if row and row["display_name"]:
            return str(row["display_name"]).strip() or username_text
        return str(fallback or username_text).strip() or username_text

    def _job_row_to_dict(self, row: Any) -> Dict[str, Any]:
        if not row:
            return {}
        raw_payload: Dict[str, Any] = {}
        execution_metadata: Dict[str, Any] = {}
        mode = str(row["mode"] or "Site-Specific").strip() or "Site-Specific"
        scope = str(row["scope"] or "").strip()
        request_type = "By Dataset" if mode in {"By Dataset", "Any-Site"} else "By Source"
        status = str(row["status"] or "Unknown").strip() or "Unknown"
        source = str(row["source"] or "").strip()
        owner_username = str(row["owner_username"] or "").strip()
        display_name = self._resolve_display_name(owner_username, owner_username or source or "System")
        input_data = self._load_job_input_data(str(row["id"]))
        raw_payload = {
            "source": source,
            "website_url": source if request_type == "By Source" else None,
            "source_name": source if request_type == "By Source" else None,
            "dataset_name": source if request_type == "By Dataset" else None,
            "scope": scope,
            "frequency": row["frequency"],
            "delivery": row["delivery"],
            "output_format": row["output_format"],
            "filters": row["filters"],
            "custom_criteria": row["custom_criteria"],
            "mode": mode,
            "isCustomSource": bool(row["is_custom_source"]),
            "owner_username": owner_username or None,
            "input_data": input_data,
        }
        execution_metadata = {
            "records": row["records"],
            "records_count": row["records"],
            "fresh": row["fresh"],
            "next_refresh": row["next_refresh"],
            "last_refresh": row["last_refresh"],
            "changes_detected": row["changes_detected"] if "changes_detected" in row.keys() else None,
            "complexity": row["complexity"] if "complexity" in row.keys() else None,
            "estimated_onboarding_time": row["estimated_onboarding_time"] if "estimated_onboarding_time" in row.keys() else None,
            "refresh_count": row["refresh_count"],
            "is_urgent": bool(row["is_urgent"]) if "is_urgent" in row.keys() else False,
            "source_kind": self._source_kind(
                request_type,
                scope,
                mode,
                raw_payload,
            ),
        }
        created_at = _parse_dt(row["created_at"])
        updated_at = _parse_dt(row["last_refresh"]) or _parse_dt(row["created_at"])
        timeline: List[Dict[str, Any]] = []
        if created_at:
            timeline.append(
                {
                    "timestamp": created_at,
                    "event": "created",
                    "request_status": status,
                    "job_status": status,
                    "planner_status": None,
                }
            )
        if updated_at and (not created_at or updated_at != created_at):
            timeline.append(
                {
                    "timestamp": updated_at,
                    "event": "status_update",
                    "request_status": status,
                    "job_status": status,
                    "planner_status": None,
                }
            )
        return {
            "id": str(row["id"]),
            "job_id": str(row["id"]),
            "request_type": request_type,
            "source_kind": execution_metadata["source_kind"],
            "source": source,
            "dataset_name": source if request_type == "By Dataset" else None,
            "mode": mode,
            "scope": scope,
            "user_id": owner_username or None,
            "username": owner_username or "system",
            "role": "user",
            "display_name": display_name,
            "raw_payload": raw_payload,
            "planner_json": json_loads(row["planner_json"], {}) if "planner_json" in row.keys() else {},
            "planner_status": None,
            "request_status": status,
            "status_label": self._status_label(status, None),
            "job_status": status,
            "status_reason": None,
            "execution_metadata": execution_metadata,
            "timeline": timeline,
            "decision_state": None,
            "decision_by": None,
            "decision_at": None,
            "decision_reason": None,
            "created_at": created_at or updated_at,
            "updated_at": updated_at or created_at,
            "investigated": False,
            "investigated_at": None,
            "investigated_by": None,
            "investigated_notes": None,
        }

    def _merge_request_rows(self, audit_row: Dict[str, Any], live_row: Dict[str, Any]) -> Dict[str, Any]:
        if not audit_row:
            return dict(live_row or {})
        if not live_row:
            return dict(audit_row)
        merged = dict(audit_row)
        merged["job_id"] = live_row.get("job_id") or merged.get("job_id")
        merged["request_type"] = merged.get("request_type") or live_row.get("request_type")
        merged["source_kind"] = live_row.get("source_kind") or merged.get("source_kind")
        merged["source"] = live_row.get("source") or merged.get("source")
        merged["dataset_name"] = live_row.get("dataset_name") or merged.get("dataset_name")
        merged["mode"] = live_row.get("mode") or merged.get("mode")
        merged["scope"] = live_row.get("scope") or merged.get("scope")
        merged["raw_payload"] = {**(merged.get("raw_payload") or {}), **(live_row.get("raw_payload") or {})}
        merged["execution_metadata"] = {
            **(merged.get("execution_metadata") or {}),
            **(live_row.get("execution_metadata") or {}),
        }
        merged["request_status"] = live_row.get("request_status") or merged.get("request_status")
        merged["job_status"] = live_row.get("job_status") or merged.get("job_status")
        merged["status_label"] = self._status_label(merged.get("request_status"), merged.get("planner_status"))
        merged["created_at"] = live_row.get("created_at") or merged.get("created_at")
        merged["updated_at"] = live_row.get("updated_at") or merged.get("updated_at")
        merged["timeline"] = live_row.get("timeline") or merged.get("timeline") or []
        merged["investigated"] = bool(merged.get("investigated"))
        return merged

    @staticmethod
    def _source_kind(
        request_type: Optional[str],
        scope: Optional[str],
        mode: Optional[str],
        raw_payload: Optional[Dict[str, Any]],
    ) -> str:
        request_type_text = str(request_type or "").strip()
        scope_text = str(scope or "").strip().lower()
        mode_text = str(mode or "").strip().lower()
        payload = raw_payload if isinstance(raw_payload, dict) else {}

        if request_type_text == "By Dataset":
            return "By Dataset"
        if "partial" in scope_text or any(key in payload for key in ("end_urls", "prompt", "files")):
            return "Partial Scrape"
        if payload.get("website_url") or payload.get("source_name") or (mode_text == "site-specific" and scope_text == "full dump"):
            return "New Source"
        return "Full Scrape"

    @staticmethod
    def _status_label(request_status: Optional[str], planner_status: Optional[str]) -> str:
        planner = str(planner_status or "").strip().lower()
        request = str(request_status or "").strip()
        if planner == "unsupported":
            return "Unsupported Request"
        if planner == "needs_clarification":
            return "Needs Clarification"
        if request == "Review Pending":
            return "Awaiting Review"
        if request == "Planner Rejected":
            return "Planner Rejected"
        return request or "Unknown"

    def record_request(
        self,
        *,
        job_id: str,
        request_type: str,
        source: Optional[str],
        dataset_name: Optional[str],
        mode: Optional[str],
        scope: Optional[str],
        user: Dict[str, Any],
        raw_payload: Dict[str, Any],
        planner_json: Optional[Dict[str, Any]] = None,
        planner_status: Optional[str] = None,
        request_status: Optional[str] = None,
        job_status: Optional[str] = None,
        status_reason: Optional[str] = None,
        execution_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        now = _now()
        source_kind = str((execution_metadata or {}).get("source_kind") or "").strip() or self._source_kind(
            request_type,
            scope,
            mode,
            raw_payload,
        )
        merged_metadata = dict(execution_metadata or {})
        merged_metadata["source_kind"] = source_kind
        payload = {
            "id": f"req_{uuid4().hex[:12]}",
            "job_id": job_id,
            "request_type": request_type,
            "source_kind": source_kind,
            "source": source,
            "dataset_name": dataset_name,
            "mode": mode,
            "scope": scope,
            "user_id": user.get("user_id"),
            "username": user.get("username"),
            "role": user.get("role"),
            "display_name": user.get("display_name"),
            "raw_payload": raw_payload or {},
            "planner_json": planner_json or {},
            "planner_status": planner_status,
            "request_status": request_status,
            "job_status": job_status,
            "status_reason": status_reason,
            "execution_metadata": merged_metadata,
            "decision_state": None,
            "decision_by": None,
            "decision_at": None,
            "decision_reason": None,
            "timeline": [
                {
                    "timestamp": now,
                    "event": "created",
                    "request_status": request_status,
                    "job_status": job_status,
                    "planner_status": planner_status,
                }
            ],
            "created_at": now,
            "updated_at": now,
            "investigated": 0,
            "investigated_at": None,
            "investigated_by": None,
            "investigated_notes": None,
        }
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO admin_request_audit (
                    id, job_id, request_type, source, dataset_name, mode, scope,
                    user_id, username, role, display_name, raw_payload_json,
                    planner_json, planner_status, request_status, job_status,
                    status_reason, execution_metadata_json, timeline_json,
                    decision_state, decision_by, decision_at, decision_reason,
                    created_at, updated_at, investigated, investigated_at,
                    investigated_by, investigated_notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                    request_type = excluded.request_type,
                    source = excluded.source,
                    dataset_name = excluded.dataset_name,
                    mode = excluded.mode,
                    scope = excluded.scope,
                    user_id = excluded.user_id,
                    username = excluded.username,
                    role = excluded.role,
                    display_name = excluded.display_name,
                    raw_payload_json = excluded.raw_payload_json,
                    planner_json = excluded.planner_json,
                    planner_status = excluded.planner_status,
                    request_status = excluded.request_status,
                    job_status = excluded.job_status,
                    status_reason = excluded.status_reason,
                    execution_metadata_json = excluded.execution_metadata_json,
                    timeline_json = excluded.timeline_json,
                    decision_state = excluded.decision_state,
                    decision_by = excluded.decision_by,
                    decision_at = excluded.decision_at,
                    decision_reason = excluded.decision_reason,
                    updated_at = excluded.updated_at
                """,
                (
                    payload["id"],
                    payload["job_id"],
                    payload["request_type"],
                    payload["source"],
                    payload["dataset_name"],
                    payload["mode"],
                    payload["scope"],
                    payload["user_id"],
                    payload["username"],
                    payload["role"],
                    payload["display_name"],
                    json_dumps(payload["raw_payload"]),
                    json_dumps(payload["planner_json"]),
                    payload["planner_status"],
                    payload["request_status"],
                    payload["job_status"],
                    payload["status_reason"],
                    json_dumps(payload["execution_metadata"]),
                    json_dumps(payload["timeline"]),
                    payload["decision_state"],
                    payload["decision_by"],
                    payload["decision_at"],
                    payload["decision_reason"],
                    payload["created_at"],
                    payload["updated_at"],
                    payload["investigated"],
                    payload["investigated_at"],
                    payload["investigated_by"],
                    payload["investigated_notes"],
                ),
            )
            conn.commit()
        logger.info("[Admin Audit] recorded request %s for job %s", payload["id"], job_id)
        return payload

    def update_job_state(
        self,
        *,
        job_id: str,
        request_status: Optional[str] = None,
        job_status: Optional[str] = None,
        planner_status: Optional[str] = None,
        status_reason: Optional[str] = None,
        execution_metadata: Optional[Dict[str, Any]] = None,
        event: Optional[str] = None,
        decision_state: Optional[str] = None,
        decision_by: Optional[str] = None,
        decision_at: Optional[str] = None,
        decision_reason: Optional[str] = None,
    ) -> None:
        with get_connection() as conn:
            row = conn.execute("SELECT * FROM admin_request_audit WHERE job_id = ?", (job_id,)).fetchone()
            if not row:
                return
            timeline = json_loads(row["timeline_json"], [])
            current_metadata = json_loads(row["execution_metadata_json"], {})
            merged_metadata = dict(current_metadata) if isinstance(current_metadata, dict) else {}
            if isinstance(execution_metadata, dict):
                merged_metadata.update(execution_metadata)
            entry = {
                "timestamp": _now(),
                "event": event or "status_update",
                "request_status": request_status or row["request_status"],
                "job_status": job_status or row["job_status"],
                "planner_status": planner_status or row["planner_status"],
                "status_reason": status_reason,
                "execution_metadata": merged_metadata,
                "decision_state": decision_state or row["decision_state"],
                "decision_by": decision_by or row["decision_by"],
                "decision_at": decision_at or row["decision_at"],
                "decision_reason": decision_reason or row["decision_reason"],
            }
            timeline.append(entry)
            conn.execute(
                """
                UPDATE admin_request_audit
                SET request_status = COALESCE(?, request_status),
                    job_status = COALESCE(?, job_status),
                    planner_status = COALESCE(?, planner_status),
                    status_reason = COALESCE(?, status_reason),
                    execution_metadata_json = COALESCE(?, execution_metadata_json),
                    decision_state = COALESCE(?, decision_state),
                    decision_by = COALESCE(?, decision_by),
                    decision_at = COALESCE(?, decision_at),
                    decision_reason = COALESCE(?, decision_reason),
                    timeline_json = ?,
                    updated_at = ?
                WHERE job_id = ?
                """,
                (
                    request_status,
                    job_status,
                    planner_status,
                    status_reason,
                    json_dumps(merged_metadata) if execution_metadata is not None else None,
                    decision_state,
                    decision_by,
                    decision_at,
                    decision_reason,
                    json_dumps(timeline),
                    _now(),
                    job_id,
                ),
            )
            conn.commit()

    def mark_investigated(
        self,
        *,
        request_id: str,
        investigated_by: str,
        notes: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        now = _now()
        with get_connection() as conn:
            row = conn.execute("SELECT * FROM admin_request_audit WHERE id = ?", (request_id,)).fetchone()
            if not row:
                return None
            conn.execute(
                """
                UPDATE admin_request_audit
                SET investigated = 1,
                    investigated_at = ?,
                    investigated_by = ?,
                    investigated_notes = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (now, investigated_by, notes, now, request_id),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM admin_request_audit WHERE id = ?", (request_id,)).fetchone()
        return self._row_to_dict(row) if row else None

    def get_request(self, request_id: str) -> Optional[Dict[str, Any]]:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM admin_request_audit WHERE id = ? OR job_id = ? LIMIT 1",
                (request_id, request_id),
            ).fetchone()
            if row:
                return self._row_to_dict(row)
            live_row = conn.execute("SELECT * FROM scraper_jobs WHERE id = ? LIMIT 1", (request_id,)).fetchone()
        return self._job_row_to_dict(live_row) if live_row else None

    def get_by_job_id(self, job_id: str) -> Optional[Dict[str, Any]]:
        with get_connection() as conn:
            row = conn.execute("SELECT * FROM admin_request_audit WHERE job_id = ? LIMIT 1", (job_id,)).fetchone()
            if row:
                return self._row_to_dict(row)
            live_row = conn.execute("SELECT * FROM scraper_jobs WHERE id = ? LIMIT 1", (job_id,)).fetchone()
        return self._job_row_to_dict(live_row) if live_row else None

    def delete_by_job_id(self, job_id: str) -> int:
        with get_connection() as conn:
            cur = conn.execute("DELETE FROM admin_request_audit WHERE job_id = ?", (job_id,))
            conn.commit()
            return int(cur.rowcount or 0)

    def list_requests(
        self,
        *,
        request_type: Optional[str] = None,
        status: Optional[str] = None,
        username: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        with get_connection() as conn:
            audit_rows = conn.execute("SELECT * FROM admin_request_audit").fetchall()
            live_rows = conn.execute("SELECT * FROM scraper_jobs").fetchall()

        merged_by_job_id: Dict[str, Dict[str, Any]] = {}
        for row in audit_rows:
            request = self._row_to_dict(row)
            job_id = str(request.get("job_id") or request.get("id") or "").strip()
            if job_id:
                merged_by_job_id[job_id] = request

        for row in live_rows:
            live_request = self._job_row_to_dict(row)
            job_id = str(live_request.get("job_id") or live_request.get("id") or "").strip()
            if not job_id:
                continue
            existing = merged_by_job_id.get(job_id)
            if existing:
                merged_by_job_id[job_id] = self._merge_request_rows(existing, live_request)
            else:
                merged_by_job_id[job_id] = live_request

        rows = list(merged_by_job_id.values())
        filtered: List[Dict[str, Any]] = []
        for row in rows:
            if request_type and request_type != "All" and row.get("request_type") != request_type:
                continue
            if status and status != "All":
                effective_status = str(row.get("status_label") or row.get("request_status") or row.get("job_status") or "").strip()
                if status == "Aborted":
                    if effective_status not in {"Aborted", "Failed"}:
                        continue
                elif effective_status != status:
                    continue
            if username and username not in str(row.get("username") or ""):
                continue
            created_at = _parse_dt(row.get("created_at"))
            if from_date:
                from_dt = _parse_dt(from_date)
                if from_dt and created_at and created_at < from_dt:
                    continue
            if to_date:
                to_dt = _parse_dt(to_date)
                if to_dt and created_at and created_at > to_dt:
                    continue
            filtered.append(row)

        filtered.sort(key=lambda item: _parse_dt(item.get("created_at")) or _parse_dt(item.get("updated_at")) or datetime.min, reverse=True)
        return filtered[:limit]

    def get_summary(
        self,
        *,
        request_type: Optional[str] = None,
        status: Optional[str] = None,
        username: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
    ) -> Dict[str, int]:
        rows = self.list_requests(
            request_type=request_type,
            status=status,
            username=username,
            from_date=from_date,
            to_date=to_date,
            limit=5000,
        )
        summary = {
            "total_requests": len(rows),
            "running": 0,
            "completed": 0,
            "failed": 0,
            "unsupported": 0,
            "needs_clarification": 0,
            "awaiting_review": 0,
            "pending_onboarding": 0,
            "refreshing": 0,
        }
        for row in rows:
            request_status = str(row.get("request_status") or "").strip()
            planner_status = str(row.get("planner_status") or "").strip().lower()
            if request_status == "Running":
                summary["running"] += 1
            elif request_status == "Completed":
                summary["completed"] += 1
            elif request_status == "Failed":
                summary["failed"] += 1
            elif request_status == "Refreshing":
                summary["refreshing"] += 1
            elif request_status == "Review Pending":
                summary["awaiting_review"] += 1
            elif request_status == "Pending Onboarding":
                summary["pending_onboarding"] += 1

            if planner_status == "unsupported":
                summary["unsupported"] += 1
            if planner_status == "needs_clarification":
                summary["needs_clarification"] += 1
        return summary

    def _row_to_dict(self, row: Any) -> Dict[str, Any]:
        if not row:
            return {}
        request_status = row["request_status"]
        planner_status = row["planner_status"]
        timeline = json_loads(row["timeline_json"], [])
        timeline_times = [
            _parse_dt(entry.get("timestamp"))
            for entry in timeline
            if isinstance(entry, dict) and _parse_dt(entry.get("timestamp"))
        ]
        created_at = timeline_times[0] if timeline_times else _parse_dt(row["created_at"])
        updated_at = timeline_times[-1] if timeline_times else _parse_dt(row["updated_at"])
        return {
            "id": row["id"],
            "job_id": row["job_id"],
            "request_type": row["request_type"],
            "source_kind": (json_loads(row["execution_metadata_json"], {}) or {}).get("source_kind")
            or self._source_kind(
                row["request_type"],
                row["scope"],
                row["mode"],
                json_loads(row["raw_payload_json"], {}),
            ),
            "source": row["source"],
            "dataset_name": row["dataset_name"],
            "mode": row["mode"],
            "scope": row["scope"],
            "user_id": row["user_id"],
            "username": row["username"],
            "role": row["role"],
            "display_name": row["display_name"],
            "raw_payload": json_loads(row["raw_payload_json"]),
            "planner_json": json_loads(row["planner_json"]),
            "planner_status": planner_status,
            "request_status": request_status,
            "status_label": self._status_label(request_status, planner_status),
            "job_status": row["job_status"],
            "status_reason": row["status_reason"],
            "execution_metadata": json_loads(row["execution_metadata_json"]),
            "timeline": json_loads(row["timeline_json"], []),
            "decision_state": row["decision_state"],
            "decision_by": row["decision_by"],
            "decision_at": _parse_dt(row["decision_at"]),
            "decision_reason": row["decision_reason"],
            "created_at": created_at,
            "updated_at": updated_at,
            "investigated": bool(row["investigated"]),
            "investigated_at": _parse_dt(row["investigated_at"]),
            "investigated_by": row["investigated_by"],
            "investigated_notes": row["investigated_notes"],
        }


admin_request_audit_service = AdminRequestAuditService()
