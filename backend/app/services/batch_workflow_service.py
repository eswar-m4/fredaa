"""
Batch CSV/Excel workflow processing — runs verification on every parsed row.
"""

from __future__ import annotations

import re
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import pandas as pd

from app.core.logger import setup_logger
from app.services.company_verification_service import normalize_workflow_record
from app.services.parser_service import parser_service
from app.services.upload_service import upload_service
from app.services.workflow_service import workflow_service

logger = setup_logger(__name__)

COLUMN_ALIASES = {
    "company": ["company", "company_name", "name", "organization", "hospital_name", "business_name"],
    "website": ["website", "domain", "url", "site", "web"],
    "email": ["email", "email_address", "mail"],
    "phone": ["phone", "phone_number", "telephone", "mobile"],
    "linkedin": ["linkedin", "linkedin_url", "linkedin_profile"],
}


def _normalize_col(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")


def _map_columns(columns: List[str]) -> Dict[str, str]:
    normalized = {_normalize_col(c): c for c in columns}
    mapping: Dict[str, str] = {}
    for field, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in normalized:
                mapping[field] = normalized[alias]
                break
    return mapping


def _row_to_record(row: Dict[str, Any], col_map: Dict[str, str], row_index: int) -> Dict[str, Any]:
    record: Dict[str, Any] = {"_row_index": row_index}
    for field, col_key in col_map.items():
        raw = row.get(col_key)
        if raw is not None and str(raw).strip().lower() not in ("", "nan", "none", "null"):
            record[field] = str(raw).strip()
    if not record.get("company"):
        for key, value in row.items():
            if value and str(value).strip().lower() not in ("nan", "none", "null"):
                record["company"] = str(value).strip()
                break
    return record


def parse_upload_to_records(file_bytes: bytes, filename: str) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    file_format = upload_service.detect_file_format(filename)
    if file_format not in ("csv", "xlsx", "xls"):
        raise ValueError(f"Unsupported batch format: {file_format}. Use CSV or Excel.")

    summary = parser_service.parse(file_bytes, file_format)
    buffer = BytesIO(file_bytes)
    if file_format == "csv":
        df = pd.read_csv(buffer, dtype=str)
    else:
        df = pd.read_excel(buffer, dtype=str)

    df = df.fillna("")
    col_map = _map_columns(df.columns.tolist())
    records: List[Dict[str, Any]] = []
    for idx, row in df.iterrows():
        row_dict = row.to_dict()
        rec = _row_to_record(row_dict, col_map, int(idx))
        if rec.get("company"):
            records.append(rec)

    meta = {
        "filename": filename,
        "format": file_format,
        "total_rows": int(len(df)),
        "parsed_rows": len(records),
        "columns": df.columns.tolist(),
        "column_mapping": col_map,
        "parse_summary": summary,
    }
    return records, meta


def _build_processed_row(
    original: Dict[str, Any],
    result: Dict[str, Any],
) -> Dict[str, Any]:
    status = result.get("status") or "Verification Failed"
    return {
        "record_id": f"row_{original.get('_row_index', 0)}",
        "original_data": {k: v for k, v in original.items() if not str(k).startswith("_")},
        "discovered_website": result.get("website"),
        "selected_domain": result.get("selected_domain"),
        "scraped_metadata": result.get("scraped_metadata") or {},
        "field_provenance": result.get("field_provenance") or result.get("_field_provenance") or {},
        "confidence_score": result.get("confidence") or result.get("confidenceScore") or 0,
        "confidence_reasons": result.get("confidence_reasons") or [],
        "trust": result.get("trust") or {},
        "approval_status": status,
        "reason": _status_reason(result),
        "record_comparison": result.get("record_comparison") or {},
        "website_candidates": result.get("website_candidates") or [],
        "ambiguous_candidates": result.get("ambiguous_candidates", False),
        "registry_metadata": result.get("registry_metadata") or {},
        "company": result.get("company") or original.get("company"),
    }


def _status_reason(result: Dict[str, Any]) -> str:
    reasons = result.get("confidence_reasons") or []
    if reasons:
        return "; ".join(reasons[:3])
    comparison = result.get("record_comparison") or {}
    return comparison.get("summary") or result.get("status") or ""


class BatchWorkflowService:
    async def process_file(
        self,
        file_bytes: bytes,
        filename: str,
        config: Dict[str, Any],
    ) -> Dict[str, Any]:
        records, file_meta = parse_upload_to_records(file_bytes, filename)
        dataset_id = config.get("datasetId") or f"batch_{uuid4().hex[:10]}"
        dataset_name = config.get("datasetName") or filename

        dataset = {
            "id": dataset_id,
            "name": dataset_name,
            "records": records,
        }
        run_summary = await workflow_service.run_workflow(dataset, config)

        auto_approved: List[Dict[str, Any]] = []
        review_records: List[Dict[str, Any]] = []
        failed_records: List[Dict[str, Any]] = []

        for original, result in zip(records, run_summary.get("record_results") or []):
            processed = _build_processed_row(original, result)
            status = processed["approval_status"]
            if status == "Auto Approved":
                auto_approved.append(processed)
            elif status == "Verification Failed":
                failed_records.append(processed)
            else:
                review_records.append(processed)

        return {
            "batch_id": run_summary.get("run_id"),
            "dataset_id": dataset_id,
            "dataset_name": dataset_name,
            "file": file_meta,
            "summary": {
                "total_records": len(records),
                "auto_approved": len(auto_approved),
                "needs_review": len(review_records),
                "failed": len(failed_records),
            },
            "auto_approved_records": auto_approved,
            "review_records": review_records,
            "failed_records": failed_records,
            "run_summary": run_summary,
        }


batch_workflow_service = BatchWorkflowService()
