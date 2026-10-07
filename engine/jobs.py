from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from product_api import submit_solution_request

JOBS_PATH = Path(__file__).resolve().parents[1] / "data" / "jobs.json"


def list_jobs() -> list[dict]:
    if not JOBS_PATH.exists():
        return []
    try:
        return json.loads(JOBS_PATH.read_text())
    except json.JSONDecodeError:
        return []


def extras_volume(req: dict) -> str | None:
    extras = req.get("extras") or {}
    return extras.get("volume") or req.get("volume")


def _request_narrative(payload: dict) -> str:
    req = payload.get("requirement") or {}
    estimate = payload.get("estimate") or {}
    lines: list[str] = []
    if req.get("objective"):
        lines.append(str(req["objective"]))
    facts = [
        ("Entity", req.get("entityType")),
        ("Industry", req.get("industry")),
        ("Geography", req.get("geography") or req.get("country") or req.get("city")),
        ("Frequency", req.get("frequency") or req.get("recurring") or estimate.get("refresh")),
        ("Volume", extras_volume(req) or estimate.get("volume")),
        ("Fields", ", ".join(req.get("attributes") or [])),
        ("Sources", ", ".join(req.get("sources") or [])),
    ]
    for label, value in facts:
        if value:
            lines.append(f"{label}: {value}")
    for item in payload.get("answers") or []:
        prompt = (item.get("prompt") or item.get("field") or "").strip()
        answer = (item.get("answer") or "").strip()
        if prompt and answer:
            lines.append(f"{prompt}: {answer}")
    return "\n".join(lines).strip() or (payload.get("title") or "Ask Freda requirement")


def _metadata(payload: dict) -> list[dict]:
    req = payload.get("requirement") or {}
    extras = req.get("extras") or {}
    rows = [
        {"label": "family", "value": payload.get("family") or "generic"},
        {"label": "entity", "value": req.get("entityType")},
        {"label": "industry", "value": req.get("industry")},
        {"label": "geography", "value": req.get("geography") or req.get("country")},
        {"label": "frequency", "value": req.get("frequency") or req.get("recurring")},
        {"label": "scope", "value": extras.get("scope")},
    ]
    return [{"label": row["label"], "value": row["value"]} for row in rows if row["value"]]


def create_job(payload: dict) -> dict:
    req = payload.get("requirement") or {}
    estimate = payload.get("estimate") or {}
    title = payload.get("title") or req.get("entityType") or req.get("objective") or "Ask Freda requirement"
    remote = submit_solution_request(
        {
            "title": title,
            "request": _request_narrative(payload),
            "attributes": list(req.get("attributes") or []),
            "sources": list(req.get("sources") or []),
            "metadata": _metadata(payload),
            "volume": estimate.get("volume") or extras_volume(req),
            "timeline": estimate.get("timeline"),
            "cadence": req.get("frequency") or req.get("recurring") or estimate.get("refresh"),
        }
    )
    now = datetime.now(timezone.utc)
    job = {
        "id": remote["job_id"],
        "createdAt": now.isoformat(),
        "status": "Solution Requested",
        "title": title,
        "requirement": req,
        "family": payload.get("family") or "generic",
        "estimate": estimate,
        "origin": "Ask Freda",
        "answers": payload.get("answers") or [],
        "platformJobId": remote["job_id"],
    }
    jobs = list_jobs()
    jobs.append(job)
    JOBS_PATH.parent.mkdir(parents=True, exist_ok=True)
    JOBS_PATH.write_text(json.dumps(jobs, indent=2))
    return job
