"""
API routes for F.R.E.D.A multimodal input engine

This module defines all API endpoints:
- Health check: Verify service is running
- File upload: Accept multimodal data with parsing
- Process input: AI-powered input understanding (Phase 3)

Additional endpoints will be added in later phases.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Body, Request, Form
from fastapi.responses import StreamingResponse
from datetime import datetime
from typing import Any, Dict, List, Optional, Union
import time
import csv
import io
import json
import requests
from app.config import settings
from app.models.schemas import HealthCheckResponse, UploadResponse, ErrorResponse
from app.models.ai_schemas import ProcessedInput, ProcessInputRequest
from app.models.schema_inference_schemas import SchemaInferenceResult
from app.services.upload_service import upload_service
from app.services.workflow_service import workflow_service
from app.services.parser_service import parser_service
from app.services.ai_understanding_service import ai_understanding_service
from app.services.schema_inference_service import schema_inference_service
from app.services.process_gateway_service import process_gateway_service
from app.services.source_discovery_service import source_discovery_service
from app.services.candidate_resolution_service import candidate_resolution_service
from app.core.logger import setup_logger
from app.services.normalization_service import normalization_service
from app.services.relationship_inference_service import relationship_inference_service
from app.services.confidence_service import confidence_service
from app.services.website_complexity_classifier import website_complexity_classifier_service
from app.services.confidence_report_html_service import confidence_report_html_service
from app.models.unified_schemas import (
    MultiFileNormalizeResponse,
    NormalizedFileEntry,
    UnifiedSchema,
    UnifiedProcessResponse,
)

logger = setup_logger(__name__)

# Create router for API endpoints
router = APIRouter()


@router.get(
    "/health",
    response_model=HealthCheckResponse,
    summary="Health Check",
    description="Verify that F.R.E.D.A backend service is running and healthy"
)
async def health_check() -> HealthCheckResponse:
    """
    Health check endpoint.
    
    Returns:
        HealthCheckResponse with service status, version, and timestamp
    """
    logger.info("Health check requested")
    
    return HealthCheckResponse(
        status="healthy",
        version=settings.APP_VERSION,
        message="F.R.E.D.A backend is operational"
    )


@router.post(
    "/process",
    response_model=UnifiedProcessResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid input or processing failed"},
        413: {"model": ErrorResponse, "description": "File too large"},
        500: {"model": ErrorResponse, "description": "Server error"},
    },
    summary="Primary enterprise gateway for any input type",
    description=(
        "Main public API endpoint for F.R.E.D.A. Accepts multiple uploaded files, raw text, "
        "structured JSON, and partial records. Automatically orchestrates parsing, AI "
        "understanding, schema inference, normalization, relationship understanding, "
        "confidence/provenance, source discovery, candidate resolution, live source retrieval, "
        "enrichment, freshness detection, and recommended enterprise changes."
    ),
)
async def process(
    request: Request,
    files: List[UploadFile] = File(None),
    text: Optional[str] = Form(None),
    json_payload: Optional[str] = Form(None),
    user_defined_sources: Optional[str] = Form(None),
) -> UnifiedProcessResponse:
    try:
        return await process_gateway_service.process(
            request=request,
            files=files,
            raw_text=text,
            json_payload=json_payload,
            user_defined_sources=user_defined_sources,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Gateway processing failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to process input")


@router.post(
    "/workflows/run",
    summary="Execute a configured workflow against a dataset",
    description=(
        "Run website discovery, metadata scraping, confidence scoring, record comparison, "
        "and review-queue routing for each record in the dataset."
    ),
)
async def run_workflow_endpoint(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        config = payload.get('workflowConfig') or payload.get('config') or {}
        dataset = payload.get('dataset') or {}
        # Basic validation
        if not dataset or not dataset.get('records'):
            raise HTTPException(status_code=400, detail='Dataset with records is required')

        result = await workflow_service.run_workflow(dataset, config)
        return {
            'success': True,
            'summary': result,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error('Workflow execution failed: %s', e, exc_info=True)
        raise HTTPException(status_code=500, detail='Workflow execution failed')


@router.post(
    "/workflows/preflight-analysis",
    summary="Classify website complexity and recommend workflows",
    description=(
        "Runs Ollama/Qwen3 preflight analysis. Uses Website Complexity.xlsx criteria for "
        "complexity classification and analyzes selected mapped fields for workflow recommendations."
    ),
)
async def workflow_preflight_analysis_endpoint(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        selected_fields = payload.get("selected_fields") or payload.get("mapped_fields") or []
        source_url = payload.get("source_url") or payload.get("url") or ""
        source_name = payload.get("source_name") or payload.get("name") or ""
        notes = payload.get("notes") or payload.get("description") or ""
        result = website_complexity_classifier_service.analyze_preflight(
            source_url=source_url,
            source_name=source_name,
            notes=notes,
            selected_fields=selected_fields,
        )
        return {"success": True, **result}
    except Exception as e:
        logger.error("Preflight analysis failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Preflight analysis failed")


@router.post(
    "/workflows/field-mapping-suggestions",
    summary="Suggest field mappings for unresolved headers",
    description=(
        "Uses exact normalized match first; unresolved headers fallback to Qwen (Ollama) "
        "to map into allowed superset fields."
    ),
)
async def field_mapping_suggestions_endpoint(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        input_headers = payload.get("input_headers") or []
        superset_fields = payload.get("superset_fields") or []
        result = website_complexity_classifier_service.suggest_field_mappings(
            input_headers=input_headers,
            superset_fields=superset_fields,
        )
        return {"success": True, **result}
    except Exception as e:
        logger.error("Field mapping suggestion failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Field mapping suggestion failed")


@router.post(
    "/workflows/verify-record",
    summary="Verify a single company record (Swagger testing)",
    description=(
        "Run the full verification pipeline for one record: website validation or DuckDuckGo "
        "discovery, candidate scoring, metadata scraping, comparison, and routing decision."
    ),
)
async def verify_workflow_record_endpoint(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        record = payload.get("record") or payload
        config = payload.get("workflowConfig") or payload.get("config") or {}
        if not record:
            raise HTTPException(status_code=400, detail="record is required")
        result = await workflow_service.verify_single_record(record, config)
        return {"success": True, "result": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Single record verification failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Record verification failed")


@router.get(
    "/workflows/review-queue",
    summary="List review queue (dataset + record levels)",
    description="Returns level_1_datasets summaries and level_2_records grouped by dataset_id.",
)
async def get_review_queue_endpoint() -> Dict[str, Any]:
    from app.services.review_service import review_service

    return {"success": True, "review_queue": review_service.get_review_queue()}


@router.get(
    "/workflows/review-queue/{dataset_id}",
    summary="List review queue for one dataset",
)
async def get_review_queue_for_dataset_endpoint(dataset_id: str) -> Dict[str, Any]:
    from app.services.review_service import review_service

    return {
        "success": True,
        "review_queue": review_service.get_review_queue(dataset_id),
    }


def get_job_records_from_db(job_id: str) -> Optional[Dict[str, Any]]:
    import sqlite3
    import os
    import pandas as pd
    import json
    from app.core.database import get_connection
    
    # 1. Load job details
    with get_connection() as conn:
        row = conn.execute(
            """SELECT source, scope, filters, custom_criteria 
               FROM scraper_jobs WHERE id = ?""",
            (job_id,)
        ).fetchone()
        
    if not row:
        return None
        
    source, scope, filters_str, custom_criteria = row
    
    # Resolve BASE_DIR
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    
    records = []
    source_lower = source.lower()
    
    def parse_criteria(criteria_str: str) -> dict:
        if not criteria_str or criteria_str in ("—", "- -", "All Products", "All Pages"):
            return {}
        criteria_str = criteria_str.strip()
        if criteria_str.startswith("{"):
            try:
                return json.loads(criteria_str)
            except Exception:
                pass
        
        filters = {}
        parts = criteria_str.split(",")
        for p in parts:
            if "=" in p:
                k, v = p.split("=", 1)
                k = k.strip().lower()
                v = v.strip()
                if "|" in v:
                    filters[k] = [item.strip() for item in v.split("|")]
                else:
                    filters[k] = v
        return filters

    def filter_records(records: list, filters: dict) -> list:
        if not filters:
            return records
        filtered = []
        for r in records:
            match = True
            for fk, fv in filters.items():
                r_val = None
                for rk, rv in r.items():
                    if rk.lower() == fk.lower() or rk.lower().replace("_", "") == fk.lower().replace("_", ""):
                        r_val = rv
                        break
                
                if r_val is None:
                    match = False
                    break
                
                if isinstance(fv, list):
                    list_match = False
                    for val in fv:
                        if str(val).lower() in str(r_val).lower():
                            list_match = True
                            break
                    if not list_match:
                        match = False
                        break
                else:
                    if str(fv).lower() not in str(r_val).lower():
                        match = False
                        break
            if match:
                filtered.append(r)
        return filtered

    if "keysight" in source_lower:
        from app.services.scrapers.keysight_scraper import scrape_keysight_products
        filters = parse_criteria(filters_str)
        records = scrape_keysight_products(filters)
        
    elif "webmd" in source_lower:
        csv_path = os.path.join(base_dir, "sample_webmd.csv")
        if os.path.exists(csv_path):
            df = pd.read_csv(csv_path)
            records = df.to_dict(orient="records")
            for r in records:
                for k, v in r.items():
                    if pd.isna(v):
                        r[k] = None
                if scope in ("Partial Dump", "Custom"):
                    filters = parse_criteria(filters_str)
                    records = filter_records(records, filters)
                
    elif "investegate" in source_lower:
        csv_path = os.path.join(base_dir, "sample_investegate.csv")
        if os.path.exists(csv_path):
            df = pd.read_csv(csv_path)
            records = df.to_dict(orient="records")
            for r in records:
                for k, v in r.items():
                    if pd.isna(v):
                        r[k] = None
            if scope in ("Partial Dump", "Custom"):
                filters = parse_criteria(filters_str)
                records = filter_records(records, filters)
                
    elif "turkeybrokers" in source_lower:
        csv_path = os.path.join(base_dir, "sample_turkeybrokers.csv")
        if os.path.exists(csv_path):
            df = pd.read_csv(csv_path)
            records = df.to_dict(orient="records")
            for r in records:
                for k, v in r.items():
                    if pd.isna(v):
                        r[k] = None
            if scope in ("Partial Dump", "Custom"):
                filters = parse_criteria(filters_str)
                records = filter_records(records, filters)
                
    else:
        # Custom source / New Source
        records = [{
            "url": source,
            "title": f"Sample Crawled Title for {source}",
            "meta_description": "Onboarded and crawled successfully",
            "emails": ["info@example.com"],
            "phone_numbers": ["+1 555-0199"],
            "social_links": [],
            "detected_company_name": source,
            "detected_keywords": ["crawled", "verified"],
            "page_text": "Sample visible page text parsed from company website"
        }]
            
    return {
        "run_id": job_id,
        "dataset_id": job_id,
        "dataset_name": source,
        "processed_dataset": records
    }


@router.get(
    "/export",
    summary="Export processed workflow dataset",
    description="Download the most recent processed dataset for a workflow run or dataset.",
)
async def export_processed_dataset(
    dataset_id: Optional[str] = None,
    run_id: Optional[str] = None,
    format: str = "csv",
) -> StreamingResponse:
    selected_run: Optional[Dict[str, Any]] = None
    if run_id:
        selected_run = workflow_service.runs.get(run_id)
        if not selected_run:
            selected_run = get_job_records_from_db(run_id)
    elif dataset_id:
        matching_runs = [
            run for run in workflow_service.runs.values()
            if run.get("dataset_id") == dataset_id
        ]
        selected_run = matching_runs[-1] if matching_runs else None
        if not selected_run:
            selected_run = get_job_records_from_db(dataset_id)

    if not selected_run:
        raise HTTPException(status_code=404, detail="Processed dataset not found")

    rows = selected_run.get("processed_dataset") or []
    export_format = (format or "csv").lower()
    filename = f"{selected_run.get('dataset_name') or 'processed_dataset'}-{selected_run.get('run_id')}"
    safe_filename = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in filename)

    if export_format == "json":
        body = json.dumps(rows, ensure_ascii=False, indent=2)
        return StreamingResponse(
            io.StringIO(body),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{safe_filename}.json"'},
        )

    elif export_format == "xlsx":
        import pandas as pd
        df = pd.DataFrame(rows)
        df_out = df.where(pd.notnull(df), None)
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            df_out.to_excel(writer, index=False)
        output.seek(0)
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{safe_filename}.xlsx"'},
        )

    output = io.StringIO()
    fieldnames: List[str] = []
    for row in rows:
        for key in row.keys():
            if key not in fieldnames:
                fieldnames.append(key)
    writer = csv.DictWriter(output, fieldnames=fieldnames or ["message"])
    writer.writeheader()
    if rows:
        writer.writerows(rows)
    else:
        writer.writerow({"message": "No processed records"})
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}.csv"'},
    )


@router.post(
    "/workflows/confidence-report-html/download",
    summary="Download confidence report HTML bundle (raw, enriched, highlighted)",
    description=(
        "Builds 3 HTML files from the selected source URL: "
        "raw source HTML, enriched HTML, and a confidence report HTML with red/green change highlights."
    ),
)
async def download_confidence_report_html(payload: Dict[str, Any]) -> StreamingResponse:
    try:
        filename, zip_bytes = confidence_report_html_service.build_zip_bytes(payload)
        return StreamingResponse(
            io.BytesIO(zip_bytes),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except requests.RequestException as rexc:
        logger.error("Confidence report source fetch failed: %s", rexc, exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to fetch source content for confidence report")
    except Exception as e:
        logger.error("Confidence report generation failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Confidence report generation failed")


@router.post(
    "/workflows/confidence-report-html/source-highlighted/download",
    summary="Download highlighted source HTML",
    description=(
        "Fetches the selected source page, removes non-essential content, and returns "
        "a highlighted source HTML where old values are red and updated values are green."
    ),
)
async def download_highlighted_source_html(payload: Dict[str, Any]) -> StreamingResponse:
    try:
        filename, html_bytes = confidence_report_html_service.build_highlighted_source_html_bytes(payload)
        return StreamingResponse(
            io.BytesIO(html_bytes),
            media_type="text/html; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except requests.RequestException as rexc:
        logger.error("Highlighted source HTML fetch failed: %s", rexc, exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to fetch source content")
    except Exception as e:
        logger.error("Highlighted source HTML generation failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Highlighted source HTML generation failed")


@router.post(
    "/workflows/batch-process",
    summary="Batch process uploaded CSV/Excel file through verification workflow",
    description=(
        "Parses every row in an uploaded CSV or Excel file, runs website discovery, "
        "scraping, confidence scoring, and routes records into auto-approved, review, or failed buckets."
    ),
)
async def batch_process_workflow(
    file: UploadFile = File(...),
    autoApproveThreshold: Optional[int] = Form(None),
    reviewThreshold: Optional[int] = Form(None),
    minCandidateGap: Optional[int] = Form(None),
    ambiguityScoreGap: Optional[int] = Form(None),
    concurrency: Optional[int] = Form(None),
) -> Dict[str, Any]:
    from app.services.batch_workflow_service import batch_workflow_service
    from app.config import settings as app_settings

    try:
        filename = file.filename or "upload.csv"
        content = await file.read()
        is_valid, error_message = upload_service.validate_file_metadata(
            filename=filename,
            file_size=len(content),
            max_size_mb=app_settings.MAX_UPLOAD_SIZE_MB,
        )
        if not is_valid:
            raise HTTPException(status_code=400, detail=error_message)

        config = {
            "autoApproveThreshold": autoApproveThreshold or app_settings.WORKFLOW_AUTO_APPROVE_THRESHOLD,
            "reviewThreshold": reviewThreshold or app_settings.WORKFLOW_REVIEW_THRESHOLD,
            "minCandidateGap": minCandidateGap or app_settings.WORKFLOW_MIN_CANDIDATE_GAP,
            "ambiguityScoreGap": ambiguityScoreGap or app_settings.WORKFLOW_AMBIGUITY_SCORE_GAP,
            "concurrency": concurrency or 3,
            "datasetName": filename,
        }
        result = await batch_workflow_service.process_file(content, filename, config)
        return {"success": True, **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Batch workflow failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Batch workflow processing failed")


@router.get(
    "/reviews",
    summary="List review queue items",
)
async def list_reviews_endpoint(
    dataset_id: Optional[str] = None,
    status: Optional[str] = None,
) -> Dict[str, Any]:
    from app.services.review_service import review_service

    items = review_service.list_reviews(dataset_id=dataset_id, status=status)
    return {
        "success": True,
        "count": len(items),
        "items": items,
        "review_queue": review_service.get_review_queue(dataset_id),
    }


@router.get(
    "/reviews/{review_id}",
    summary="Get a single review queue item",
)
async def get_review_item_endpoint(review_id: str) -> Dict[str, Any]:
    from app.services.review_service import review_service

    item = review_service.get_review(review_id)
    if not item:
        raise HTTPException(status_code=404, detail="Review item not found")
    return {"success": True, "item": item}


@router.post(
    "/reviews/{review_id}/approve",
    summary="Approve a review queue item",
)
async def approve_review_endpoint(
    review_id: str,
    payload: Optional[Dict[str, Any]] = Body(None),
) -> Dict[str, Any]:
    from app.services.review_service import review_service
    from app.services.audit_service import audit_service

    try:
        approved_values = (payload or {}).get("approved_values")
        item = review_service.approve_review(review_id, approved_values=approved_values)
        audit_service.log_event(
            event_type="review_approved",
            dataset_id=item.get("dataset_id"),
            record_id=item.get("record_id"),
            review_id=review_id,
            company=item.get("company"),
            approval_path="manual_approve",
            metadata={"approved_values": approved_values or item.get("suggested_changes")},
        )
        return {"success": True, "item": item}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/reviews/{review_id}/reject",
    summary="Reject a review queue item",
)
async def reject_review_endpoint(
    review_id: str,
    payload: Optional[Dict[str, Any]] = Body(None),
) -> Dict[str, Any]:
    from app.services.review_service import review_service
    from app.services.audit_service import audit_service

    try:
        reason = (payload or {}).get("reason")
        item = review_service.reject_review(review_id, reason=reason)
        audit_service.log_event(
            event_type="review_rejected",
            dataset_id=item.get("dataset_id"),
            record_id=item.get("record_id"),
            review_id=review_id,
            company=item.get("company"),
            approval_path="manual_reject",
            metadata={"reason": reason},
        )
        return {"success": True, "item": item}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post(
    "/reviews/{review_id}/edit",
    summary="Edit/update a review queue item with corrected values",
)
async def edit_review_endpoint(
    review_id: str,
    payload: Dict[str, Any] = Body(...),
) -> Dict[str, Any]:
    from app.services.review_service import review_service
    from app.services.audit_service import audit_service

    corrected = payload.get("corrected_values") or payload
    if not corrected:
        raise HTTPException(status_code=400, detail="corrected_values is required")
    try:
        item = review_service.edit_review(review_id, corrected)
        audit_service.log_event(
            event_type="review_edited",
            dataset_id=item.get("dataset_id"),
            record_id=item.get("record_id"),
            review_id=review_id,
            company=item.get("company"),
            approval_path="manual_edit",
            metadata={"corrected_values": corrected},
        )
        return {"success": True, "item": item}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/audit",
    summary="List audit trail events",
)
async def list_audit_endpoint(dataset_id: Optional[str] = None, limit: int = 100) -> Dict[str, Any]:
    from app.services.audit_service import audit_service

    events = audit_service.list_events(dataset_id=dataset_id, limit=limit)
    return {"success": True, "count": len(events), "events": events}


@router.post(
    "/upload",
    response_model=UploadResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid upload"},
        413: {"model": ErrorResponse, "description": "File too large"},
        500: {"model": ErrorResponse, "description": "Server error"}
    },
    summary="Legacy/Internal Upload workflow (use /process)",
    description="Legacy endpoint for file upload. Use /api/v1/process for the primary gateway.",
    deprecated=True,
)
async def upload_file(file: UploadFile = File(...)) -> UploadResponse:
    """
    Upload endpoint for multimodal data.
    
    Phase 1: Accepts file upload, validates metadata, stores upload record
    Future phases: Will add file parsing, OCR, schema inference
    
    Args:
        file: Uploaded file (FastAPI UploadFile object)
        
    Returns:
        UploadResponse with upload metadata and status
        
    Raises:
        HTTPException: If file validation fails or server error occurs
    """
    try:
        # Get file metadata
        filename = file.filename or "unknown"
        
        logger.info(f"File upload initiated: {filename}")
        
        # Read file size
        # Note: We need to read content to get size, then reset for future processing
        file_content = await file.read()
        file_size = len(file_content)
        
        # Reset file pointer for future reads (important for later phases)
        await file.seek(0)
        
        # Validate file metadata
        is_valid, error_message = upload_service.validate_file_metadata(
            filename=filename,
            file_size=file_size,
            max_size_mb=settings.MAX_UPLOAD_SIZE_MB
        )
        
        if not is_valid:
            logger.warning(f"File validation failed: {error_message}")
            raise HTTPException(
                status_code=400,
                detail=error_message
            )
        
        # Detect file format
        file_format = upload_service.detect_file_format(filename)
        
        # Create upload record
        upload_record = upload_service.create_upload_record(
            filename=filename,
            file_size=file_size,
            format=file_format
        )

        # Parse the uploaded file immediately for Phase 2
        try:
            parsed_summary = parser_service.parse(file_content, file_format)
        except ValueError as parse_error:
            logger.warning(str(parse_error))
            raise HTTPException(status_code=400, detail=str(parse_error))

        upload_service.attach_parse_summary(upload_record["id"], parsed_summary)
        upload_service.update_upload_status(upload_record["id"], "processed")

        logger.info(f"File uploaded and parsed successfully: {upload_record['id']}")
        
        # Return upload response with parsed summary metadata
        return UploadResponse(
            id=upload_record["id"],
            filename=filename,
            file_size=file_size,
            format=file_format,
            status="processed",
            message="File uploaded and parsed successfully.",
            parsed_summary=parsed_summary
        )
    
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    
    except Exception as e:
        # Catch unexpected errors
        error_msg = f"Unexpected error during file upload: {str(e)}"
        logger.error(error_msg, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Internal server error during file upload"
        )


@router.post(
    "/process-input",
    response_model=ProcessedInput,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid input or parsing failed"},
        500: {"model": ErrorResponse, "description": "Server error"},
    },
    summary="Legacy/Internal AI understanding workflow (use /process)",
    description="Legacy endpoint for text understanding. Use /api/v1/process for the primary gateway.",
    deprecated=True,
)
async def process_input_text(request: ProcessInputRequest) -> ProcessedInput:
    """
    Process raw text input with AI understanding (Phase 3).
    
    Analyzes input to:
    - Identify entity type
    - Extract attributes
    - Generate normalized structure
    - Provide confidence score
    
    Args:
        request: ProcessInputRequest with text field
        
    Returns:
        ProcessedInput with AI analysis
        
    Raises:
        HTTPException: If processing fails
    """
    try:
        if not request.text or len(request.text.strip()) == 0:
            raise HTTPException(status_code=400, detail="Text input cannot be empty")

        logger.info(f"Processing text input: {request.text[:50]}...")

        # Process with AI understanding service
        processed = ai_understanding_service.understand_input(
            content=request.text,
            input_type="text",
            raw_input=request.text,
        )

        logger.info(f"Text input processed successfully. Entity type: {processed.entity_type}")

        return processed

    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Validation error during input processing: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        error_msg = f"Unexpected error during input processing: {str(e)}"
        logger.error(error_msg, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post(
    "/process-file",
    response_model=ProcessedInput,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid file or parsing failed"},
        413: {"model": ErrorResponse, "description": "File too large"},
        500: {"model": ErrorResponse, "description": "Server error"},
    },
    summary="Legacy/Internal file AI workflow (use /process)",
    description="Legacy endpoint for file AI understanding. Use /api/v1/process for the primary gateway.",
    deprecated=True,
)
async def process_file_with_ai(file: UploadFile = File(...)) -> ProcessedInput:
    """
    Process file input with AI understanding (Phase 3).
    
    Flow:
    1. Parse file to extract content
    2. Analyze extracted content with AI
    3. Return structured understanding
    
    Args:
        file: Uploaded file
        
    Returns:
        ProcessedInput with AI analysis
        
    Raises:
        HTTPException: If processing fails
    """
    try:
        filename = file.filename or "unknown"
        logger.info(f"Processing file input: {filename}")

        # Read file content
        file_content = await file.read()
        file_size = len(file_content)

        # Validate metadata
        is_valid, error_message = upload_service.validate_file_metadata(
            filename=filename,
            file_size=file_size,
            max_size_mb=settings.MAX_UPLOAD_SIZE_MB,
        )

        if not is_valid:
            logger.warning(f"File validation failed: {error_message}")
            raise HTTPException(status_code=400, detail=error_message)

        # Detect format
        file_format = upload_service.detect_file_format(filename)

        # Parse file to extract content
        try:
            parsed_summary = parser_service.parse(file_content, file_format)
        except ValueError as parse_error:
            logger.warning(str(parse_error))
            raise HTTPException(status_code=400, detail=str(parse_error))

        # Prepare content for AI analysis
        # For tabular data, use column names + sample; for text data, use text preview
        if file_format in ["csv", "xlsx"]:
            columns = parsed_summary.get("columns", [])
            content = f"Columns: {', '.join(columns[:10])}\nData columns found."
        else:
            content = parsed_summary.get("text_preview", "")

        # Process with AI understanding service
        processed = ai_understanding_service.understand_input(
            content=content, input_type=file_format, raw_input=filename
        )

        # Attach parse summary to metadata
        processed.metadata["parsed_summary"] = parsed_summary

        logger.info(
            f"File processed successfully. Entity type: {processed.entity_type}"
        )

        return processed

    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Validation error during file processing: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        error_msg = f"Unexpected error during file processing: {str(e)}"
        logger.error(error_msg, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post(
    "/infer-schema",
    response_model=SchemaInferenceResult,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid input or schema inference failed"},
        413: {"model": ErrorResponse, "description": "File too large"},
        500: {"model": ErrorResponse, "description": "Server error"},
    },
    summary="Legacy/Internal schema inference workflow (use /process)",
    description="Legacy endpoint for schema inference. Use /api/v1/process for the primary gateway.",
    deprecated=True,
)
async def infer_schema(
    request: Request,
    file: UploadFile = File(None),
    payload: Optional[Any] = Body(None),
) -> SchemaInferenceResult:
    """Infer schema semantics from uploaded files or structured JSON."""
    try:
        if file is not None:
            filename = file.filename or "unknown"
            logger.info(f"Schema inference for uploaded file: {filename}")

            file_content = await file.read()
            file_size = len(file_content)

            is_valid, error_message = upload_service.validate_file_metadata(
                filename=filename,
                file_size=file_size,
                max_size_mb=settings.MAX_UPLOAD_SIZE_MB,
            )
            if not is_valid:
                logger.warning(f"File validation failed: {error_message}")
                raise HTTPException(status_code=400, detail=error_message)

            file_format = upload_service.detect_file_format(filename)
            try:
                parsed_summary = parser_service.parse(file_content, file_format)
            except ValueError as parse_error:
                logger.warning(str(parse_error))
                raise HTTPException(status_code=400, detail=str(parse_error))

            inference = schema_inference_service.infer_schema(
                parsed_summary=parsed_summary,
                dataset_name=filename,
            )
            inference.metadata["parsed_summary"] = parsed_summary
            logger.info(f"Schema inference completed for file: {filename}")
            return inference

        if payload is None:
            content_type = request.headers.get("content-type", "")
            if "application/json" in content_type:
                try:
                    payload = await request.json()
                except Exception:
                    payload = None

        if payload is None:
            raise HTTPException(status_code=400, detail="No file or structured JSON provided for schema inference.")

        logger.info("Schema inference for structured JSON payload")
        inference = schema_inference_service.infer_schema(payload=payload)
        logger.info("Schema inference completed for structured JSON")
        return inference

    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Schema inference validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        error_msg = f"Unexpected error during schema inference: {str(e)}"
        logger.error(error_msg, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


async def _process_uploaded_file(file: UploadFile) -> Dict[str, Any]:
    """Process a single uploaded file through the normalization pipeline."""
    start_time = time.time()
    file_name = file.filename or "unknown"
    parser_used = None
    ai_status = "failed"

    try:
        content = await file.read()
        file_size = len(content)
        file_name = file.filename or "unknown"

        is_valid, error_message = upload_service.validate_file_metadata(
            filename=file_name,
            file_size=file_size,
            max_size_mb=settings.MAX_UPLOAD_SIZE_MB,
        )
        if not is_valid:
            raise ValueError(error_message)

        file_format = upload_service.detect_file_format(file_name)
        parser_used = file_format

        parsed_summary = parser_service.parse(content, file_format)

        if file_format in ["csv", "xlsx"]:
            ai_content = f"Columns: {', '.join(parsed_summary.get('columns', [])[:10])}\nData columns found."
        else:
            ai_content = parsed_summary.get("text_preview", "")

        processed = ai_understanding_service.understand_input(
            content=ai_content,
            input_type=file_format,
            raw_input=file_name,
        )
        ai_status = "succeeded"

        schema_result = schema_inference_service.infer_schema(
            parsed_summary=parsed_summary,
            dataset_name=file_name,
        )

        unified = normalization_service.normalize(
            processed_input=processed,
            parsed_summary=parsed_summary,
            schema_result=schema_result,
        )

        rels = relationship_inference_service.infer_relationships(
            unified.schema,
            sample_records=parsed_summary.get("sample") if parsed_summary else None,
        )
        unified.relationships = rels

        confs, prov = confidence_service.generate(unified.schema, [r.dict() for r in rels])
        unified.confidence = confs
        unified.provenance = prov

        unified.metadata.setdefault("processing_stages", [])
        for s in ["parse", "ai_understanding", "schema_inference", "normalization", "relationship_inference", "confidence"]:
            if s not in unified.metadata["processing_stages"]:
                unified.metadata["processing_stages"].append(s)

        unified.metadata["ai_model"] = getattr(settings, "GEMINI_MODEL", "")
        processing_time_ms = int((time.time() - start_time) * 1000)
        unified.metadata["processing_time_ms"] = processing_time_ms

        return {
            "file_name": file_name,
            "status": "success",
            "result": unified,
            "error": None,
            "processing_time_ms": processing_time_ms,
            "parser_used": parser_used,
            "ai_status": ai_status,
        }
    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        logger.error("File processing failed for %s: %s", file_name, e, exc_info=True)
        return {
            "file_name": file_name,
            "status": "failed",
            "result": None,
            "error": "Processing failed",
            "processing_time_ms": processing_time_ms,
            "parser_used": parser_used,
            "ai_status": ai_status,
        }


@router.post(
    "/normalize-data",
    response_model=Union[UnifiedSchema, MultiFileNormalizeResponse],
    summary="Legacy/Internal normalization workflow (use /process)",
    description="Legacy endpoint for normalization. Use /api/v1/process for the primary gateway.",
    deprecated=True,
)
async def normalize_data(
    request: Request,
    files: List[UploadFile] = File(None),
) -> Union[UnifiedSchema, MultiFileNormalizeResponse]:
    try:
        parsed_summary = None
        processed = None
        schema_result = None

        file_list = files or []

        if file_list:
            logger.info(f"Normalize-data: processing {len(file_list)} uploaded file(s)")
            results = []
            for uploaded_file in file_list:
                file_result = await _process_uploaded_file(uploaded_file)
                results.append(file_result)

            total_processing_time = sum((r.get("processing_time_ms") or 0) for r in results)
            dataset_types = [r["result"].dataset_type for r in results if r["status"] == "success" and r["result"].dataset_type]
            unique_dataset_types = list(dict.fromkeys(dataset_types))
            total_entities = sum(1 for r in results if r["status"] == "success")

            if len(results) == 1 and results[0]["status"] == "success":
                return results[0]["result"]

            return MultiFileNormalizeResponse(
                total_files=len(results),
                processed_files=[NormalizedFileEntry(**r) for r in results],
                combined_summary={
                    "total_entities": total_entities,
                    "dataset_types": unique_dataset_types,
                    "processing_time_ms": total_processing_time,
                },
            )

        payload = None
        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                payload = await request.json()
            except Exception:
                payload = None

        if payload is None:
            raise HTTPException(status_code=400, detail="No file or structured JSON provided for normalization.")

        # AI understanding
        try:
            if parsed_summary and parsed_summary.get("text_preview"):
                content_for_ai = parsed_summary.get("text_preview")
                input_type = parsed_summary.get("format")
            else:
                content_for_ai = str(payload)[:2000]
                input_type = "json"

            processed = ai_understanding_service.understand_input(content_for_ai, input_type, raw_input=str(payload))
        except Exception:
            processed = None

        # Schema inference
        try:
            schema_result = schema_inference_service.infer_schema(payload=payload, parsed_summary=parsed_summary)
        except Exception:
            schema_result = None

        # Normalization
        unified = normalization_service.normalize(processed_input=processed, parsed_summary=parsed_summary, schema_result=schema_result)

        # Relationship inference
        rels = relationship_inference_service.infer_relationships(unified.schema, sample_records=(parsed_summary.get("sample") if parsed_summary else None))
        unified.relationships = rels

        # Confidence and provenance
        confs, prov = confidence_service.generate(unified.schema, [r.dict() for r in rels])
        unified.confidence = confs
        unified.provenance = prov

        # Metadata
        unified.metadata.setdefault("processing_stages", [])
        for s in ["parse", "ai_understanding", "schema_inference", "normalization", "relationship_inference", "confidence"]:
            if s not in unified.metadata["processing_stages"]:
                unified.metadata["processing_stages"].append(s)

        unified.metadata.setdefault("ai_model", "")
        unified.metadata["ai_model"] = getattr(settings, "GEMINI_MODEL", "")

        return unified

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to normalize data: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to normalize data")
