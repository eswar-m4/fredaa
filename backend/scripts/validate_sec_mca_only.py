"""Live SEC/MCA-only validation for Website Verification."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app
from app.services.review_service import review_service


COMPANIES = ["Tesla", "Adobe", "Salesforce", "Nvidia", "Oracle"]
MAPPED_FIELDS = ["company_name", "website"]


def _website_comparison(comparisons: List[Dict[str, Any]]) -> Dict[str, Any]:
    for comparison in comparisons:
        if str(comparison.get("field") or "").lower() == "website":
            return comparison
    return {}


def _eye_modal_payload(company: str, entry: Dict[str, Any], record: Dict[str, Any]) -> Dict[str, Any]:
    field_comparisons = entry.get("field_comparisons") or []
    comparison = _website_comparison(field_comparisons)
    registry = record.get("registry_metadata") or {}
    raw = registry.get("raw_metadata") or {}
    source_url = (
        comparison.get("source_url")
        or raw.get("company_browse_url")
        or entry.get("source_website")
        or "#"
    )
    source_type = (
        comparison.get("source_label")
        or comparison.get("source")
        or comparison.get("priority_source")
        or "SEC EDGAR"
    )
    uploaded = entry.get("uploaded_row") or {}
    return {
        "company": company,
        "field": "website",
        "old_value": uploaded.get("website") or "-",
        "ai_recommendation": comparison.get("suggested_value") or "Nil Value",
        "source_url": source_url,
        "source_type": source_type,
    }


def main() -> None:
    review_service.clear()
    client = TestClient(app)
    validations: List[Dict[str, Any]] = []

    for index, company in enumerate(COMPANIES, start=1):
        uploaded_record = {"company_name": company, "website": "-"}
        payload = {
            "dataset": {
                "id": f"sec-mca-live-{index}",
                "name": f"sec-mca-live-{company.lower()}.csv",
                "records": [uploaded_record],
            },
            "workflowConfig": {
                "selectedWorkflows": ["Website Verification"],
                "prioritySources": ["SEC/MCA"],
                "requestedOutputFields": MAPPED_FIELDS,
                "autoApproveThreshold": 99,
                "reviewThreshold": 60,
            },
        }
        response = client.post("/api/v1/workflows/run", json=payload)
        response.raise_for_status()
        api_body = response.json()
        summary = api_body["summary"]
        record = summary["record_results"][0]
        registry = record.get("registry_metadata") or {}
        raw = registry.get("raw_metadata") or {}
        extracted = registry.get("extracted_fields") or {}
        comparison = record.get("record_comparison") or {}
        review_entry = (summary.get("review_entries") or [{}])[0]
        review_queue = summary.get("review_queue") or {}
        website_cmp = _website_comparison(comparison.get("comparisons") or [])

        validations.append(
            {
                "company": company,
                "uploaded_record": uploaded_record,
                "mapped_fields": MAPPED_FIELDS,
                "sec_lookup_result": {
                    "registry_source": registry.get("registry_source"),
                    "registry_confidence": registry.get("registry_confidence"),
                    "status": raw.get("status"),
                    "matched_by": raw.get("matched_by"),
                },
                "sec_url_discovered": raw.get("company_browse_url"),
                "raw_sec_metadata": raw,
                "extracted_metadata": extracted,
                "comparison_object": comparison,
                "api_response": {
                    "success": api_body.get("success"),
                    "run_id": summary.get("run_id"),
                    "auto_approved": summary.get("auto_approved"),
                    "needs_review": summary.get("needs_review"),
                    "processed_dataset": summary.get("processed_dataset"),
                    "website_recommendation": website_cmp.get("suggested_value"),
                    "source_url": website_cmp.get("source_url"),
                    "source_type": website_cmp.get("source_label"),
                },
                "review_queue_object": review_queue,
                "final_eye_modal_payload": _eye_modal_payload(company, review_entry, record),
            }
        )

    output = json.dumps(validations, indent=2, sort_keys=True)
    out_path = Path("data/sec_mca_live_validation.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(output, encoding="utf-8")
    print(output)
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
