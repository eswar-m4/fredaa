"""
Admin console endpoints for request visibility and audit details.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query, Request

from app.core.database import get_connection
from app.services.admin_request_audit_service import admin_request_audit_service
from app.services.bot_runtime_service import bot_runtime_service
from app.services.auth_service import auth_service

router = APIRouter()


def _require_admin(request: Request) -> Dict[str, Any]:
    return auth_service.require_session(request, role="admin")


def _to_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    return str(value)


def _decision_payload(session: Dict[str, Any], decision_state: str, reason: Optional[str] = None) -> Dict[str, Any]:
    now = datetime.utcnow().isoformat()
    return {
        "decision_state": decision_state,
        "decision_by": session.get("display_name") or session.get("username") or "admin",
        "decision_at": now,
        "decision_reason": reason or None,
    }


@router.get("/summary")
async def get_admin_summary(
    request: Request,
    request_type: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    username: Optional[str] = Query(default=None),
    from_date: Optional[str] = Query(default=None),
    to_date: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    _require_admin(request)
    summary = admin_request_audit_service.get_summary(
        request_type=request_type,
        status=status,
        username=username,
        from_date=from_date,
        to_date=to_date,
    )
    return {"success": True, "summary": summary}


@router.get("/requests")
async def list_admin_requests(
    request: Request,
    request_type: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    username: Optional[str] = Query(default=None),
    from_date: Optional[str] = Query(default=None),
    to_date: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
) -> Dict[str, Any]:
    _require_admin(request)
    rows = admin_request_audit_service.list_requests(
        request_type=request_type,
        status=status,
        username=username,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
    )
    return {
        "success": True,
        "requests": [
            {
                **row,
                "created_at": _to_iso(row.get("created_at")),
                "updated_at": _to_iso(row.get("updated_at")),
                "investigated_at": _to_iso(row.get("investigated_at")),
                "timeline": [
                    {
                        **entry,
                        "timestamp": _to_iso(entry.get("timestamp")),
                    }
                    for entry in row.get("timeline", [])
                    if isinstance(entry, dict)
                ],
            }
            for row in rows
        ],
        "total": len(rows),
    }


@router.get("/requests/{request_id}")
async def get_admin_request_detail(request: Request, request_id: str) -> Dict[str, Any]:
    _require_admin(request)
    row = admin_request_audit_service.get_request(request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    row["created_at"] = _to_iso(row.get("created_at"))
    row["updated_at"] = _to_iso(row.get("updated_at"))
    row["investigated_at"] = _to_iso(row.get("investigated_at"))
    row["timeline"] = [
        {
            **entry,
            "timestamp": _to_iso(entry.get("timestamp")),
        }
        for entry in row.get("timeline", [])
        if isinstance(entry, dict)
    ]
    return {"success": True, "request": row}


@router.post("/requests/{request_id}/investigated")
async def mark_investigated(request: Request, request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    session = _require_admin(request)
    notes = str(payload.get("notes") or "").strip() or None
    row = admin_request_audit_service.mark_investigated(
        request_id=request_id,
        investigated_by=session.get("display_name") or session.get("username") or "admin",
        notes=notes,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    row["created_at"] = _to_iso(row.get("created_at"))
    row["updated_at"] = _to_iso(row.get("updated_at"))
    row["investigated_at"] = _to_iso(row.get("investigated_at"))
    return {"success": True, "request": row}


@router.post("/requests/{request_id}/onboard")
async def onboard_bot_request(request: Request, request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    session = _require_admin(request)
    notes = str(payload.get("notes") or "").strip() or None
    uploads = payload.get("uploads") or []
    if not isinstance(uploads, list):
        uploads = []

    row = admin_request_audit_service.get_request(request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")

    execution_metadata = dict(row.get("execution_metadata") or {})
    execution_metadata["bot_uploads"] = uploads
    execution_metadata["bot_uploaded_by"] = session.get("display_name") or session.get("username") or "admin"
    execution_metadata["bot_uploaded_at"] = datetime.utcnow().isoformat()
    if notes:
        execution_metadata["bot_onboarding_notes"] = notes

    job_id = row.get("job_id")
    try:
        bot_runtime_service.onboard_request(
            request_id=request_id,
            job_id=job_id,
            session=session,
            notes=notes,
            uploads=uploads,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    updated = admin_request_audit_service.get_request(request_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Request not found")
    updated["created_at"] = _to_iso(updated.get("created_at"))
    updated["updated_at"] = _to_iso(updated.get("updated_at"))
    updated["investigated_at"] = _to_iso(updated.get("investigated_at"))
    updated["decision_at"] = _to_iso(updated.get("decision_at"))
    updated["timeline"] = [
        {**entry, "timestamp": _to_iso(entry.get("timestamp"))}
        for entry in updated.get("timeline", [])
        if isinstance(entry, dict)
    ]
    return {"success": True, "request": updated}


def _serialize_request(row: Dict[str, Any]) -> Dict[str, Any]:
    row["created_at"] = _to_iso(row.get("created_at"))
    row["updated_at"] = _to_iso(row.get("updated_at"))
    row["investigated_at"] = _to_iso(row.get("investigated_at"))
    row["decision_at"] = _to_iso(row.get("decision_at"))
    row["timeline"] = [
        {**entry, "timestamp": _to_iso(entry.get("timestamp"))}
        for entry in row.get("timeline", [])
        if isinstance(entry, dict)
    ]
    return row


@router.post("/requests/{request_id}/begin-review")
async def begin_review_request(request: Request, request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Move a Solution Requested ticket to Under Review."""
    session = _require_admin(request)
    notes = str(payload.get("notes") or "").strip() or None
    row = admin_request_audit_service.get_request(request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.get("request_status") != "Solution Requested":
        raise HTTPException(status_code=409, detail="Only Solution Requested tickets can be moved to Under Review")
    job_id = row.get("job_id")
    with get_connection() as conn:
        conn.execute("UPDATE scraper_jobs SET status = 'Under Review' WHERE id = ?", (job_id,))
        conn.commit()
    admin_request_audit_service.update_job_state(
        job_id=job_id,
        request_status="Under Review",
        job_status="Under Review",
        status_reason=notes,
        event="begin_review",
    )
    updated = admin_request_audit_service.get_request(request_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Request not found")
    return {"success": True, "request": _serialize_request(updated)}


@router.post("/requests/{request_id}/approve")
async def approve_request(request: Request, request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    session = _require_admin(request)
    reason = str(payload.get("reason") or "").strip() or None
    row = admin_request_audit_service.get_request(request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    req_type = row.get("request_type")
    req_status = row.get("request_status")
    if req_type == "By Source" and req_status != "Pending Approval":
        raise HTTPException(status_code=409, detail="Only Pending Approval By Source requests can be approved")
    if req_type == "By Dataset" and req_status not in ("Solution Requested", "Under Review"):
        raise HTTPException(status_code=409, detail="Only Solution Requested or Under Review tickets can be approved")
    if req_type not in ("By Source", "By Dataset"):
        raise HTTPException(status_code=409, detail="Invalid request type for approval")

    next_status = "Pending Onboarding" if req_type == "By Source" else "Approved"
    job_id = row.get("job_id")
    with get_connection() as conn:
        conn.execute("UPDATE scraper_jobs SET status = ? WHERE id = ?", (next_status, job_id))
        conn.commit()
    decision = _decision_payload(session, "approved", reason)
    admin_request_audit_service.update_job_state(
        job_id=job_id,
        request_status=next_status,
        job_status=next_status,
        status_reason=reason,
        execution_metadata=decision,
        event="approved",
        decision_state="approved",
        decision_by=decision["decision_by"],
        decision_at=decision["decision_at"],
        decision_reason=reason,
    )
    updated = admin_request_audit_service.get_request(request_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Request not found")
    return {"success": True, "request": _serialize_request(updated)}


@router.post("/requests/{request_id}/reject")
async def reject_request(request: Request, request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    session = _require_admin(request)
    reason = str(payload.get("reason") or "").strip() or "Rejected by admin"
    row = admin_request_audit_service.get_request(request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    req_type = row.get("request_type")
    req_status = row.get("request_status")
    if req_type == "By Source" and req_status != "Pending Approval":
        raise HTTPException(status_code=409, detail="Only Pending Approval By Source requests can be rejected")
    if req_type == "By Dataset" and req_status not in ("Solution Requested", "Under Review"):
        raise HTTPException(status_code=409, detail="Only Solution Requested or Under Review tickets can be rejected")
    if req_type not in ("By Source", "By Dataset"):
        raise HTTPException(status_code=409, detail="Invalid request type for rejection")

    job_id = row.get("job_id")
    with get_connection() as conn:
        conn.execute("UPDATE scraper_jobs SET status = 'Rejected' WHERE id = ?", (job_id,))
        conn.commit()
    decision = _decision_payload(session, "rejected", reason)
    admin_request_audit_service.update_job_state(
        job_id=job_id,
        request_status="Rejected",
        job_status="Rejected",
        status_reason=reason,
        execution_metadata=decision,
        event="rejected",
        decision_state="rejected",
        decision_by=decision["decision_by"],
        decision_at=decision["decision_at"],
        decision_reason=reason,
    )
    updated = admin_request_audit_service.get_request(request_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Request not found")
    return {"success": True, "request": _serialize_request(updated)}


@router.post("/requests/{request_id}/complete-onboarding")
async def complete_onboarding_request(request: Request, request_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Mark a Pending Onboarding or Approved ticket as Onboarding Completed (ready to run)."""
    session = _require_admin(request)
    notes = str(payload.get("notes") or "").strip() or None
    row = admin_request_audit_service.get_request(request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.get("request_status") not in ("Pending Onboarding", "Approved"):
        raise HTTPException(status_code=409, detail="Only Pending Onboarding or Approved requests can be completed")
    job_id = row.get("job_id")
    with get_connection() as conn:
        conn.execute("UPDATE scraper_jobs SET status = 'Onboarding Completed' WHERE id = ?", (job_id,))
        conn.commit()
    admin_request_audit_service.update_job_state(
        job_id=job_id,
        request_status="Onboarding Completed",
        job_status="Onboarding Completed",
        status_reason=notes,
        event="onboarding_completed",
    )
    updated = admin_request_audit_service.get_request(request_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Request not found")
    return {"success": True, "request": _serialize_request(updated)}
