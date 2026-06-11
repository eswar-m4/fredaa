"""
Gateway orchestration service for F.R.E.D.A.

This service coordinates input detection, parsing, AI understanding, schema inference,
normalization, relationship understanding, confidence generation, source discovery,
and candidate resolution.
"""

import asyncio
import json
import time
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import HTTPException, Request, UploadFile

from app.config import settings
from app.core.logger import setup_logger
from app.models.unified_schemas import UnifiedProcessResponse, ProcessedResultEntry
from app.services.ai_understanding_service import ai_understanding_service
from app.services.candidate_resolution_service import candidate_resolution_service
from app.services.confidence_service import confidence_service
from app.services.parser_service import parser_service
from app.services.relationship_inference_service import relationship_inference_service
from app.services.schema_inference_service import schema_inference_service
from app.services.normalization_service import normalization_service
from app.services.source_discovery_service import source_discovery_service
from app.services.source_retrieval_service import source_retrieval_service
from app.services.enrichment_service import enrichment_service
from app.services.freshness_detection_service import freshness_detection_service
from app.services.recommendation_service import recommendation_service
from app.services.upload_service import upload_service

logger = setup_logger(__name__)


class ProcessGatewayService:
    """Business orchestration service for the primary F.R.E.D.A gateway."""

    async def process(
        self,
        request: Request,
        files: Optional[List[UploadFile]] = None,
        raw_text: Optional[str] = None,
        json_payload: Optional[str] = None,
        user_defined_sources: Optional[str] = None,
    ) -> UnifiedProcessResponse:
        request_id = uuid4().hex
        start_time = time.time()
        processed_results: List[Dict[str, Any]] = []

        payload = await self._extract_payload(request, json_payload)
        inputs = self._build_inputs(files, raw_text, payload)
        custom_sources = self._parse_user_defined_sources(user_defined_sources)

        if not inputs:
            raise HTTPException(status_code=400, detail="No input provided. Send files, raw text, or structured JSON.")

        for entry in inputs:
            if entry["type"] == "file":
                processed_results.append(await self._process_file(entry["file"]))
            elif entry["type"] == "json":
                processed_results.append(self._process_json(entry["payload"]))
            else:
                processed_results.append(self._process_text(entry["text"]))

        source_discovery_start = time.time()
        source_candidates = source_discovery_service.discover(processed_results, custom_sources)
        source_discovery_duration_ms = int((time.time() - source_discovery_start) * 1000)

        candidate_resolution_start = time.time()
        candidate_matches = candidate_resolution_service.resolve(processed_results, source_candidates)
        candidate_resolution_duration_ms = int((time.time() - candidate_resolution_start) * 1000)

        retrieval_start = time.time()
        live_source_results = await asyncio.to_thread(
            source_retrieval_service.retrieve,
            source_candidates,
            processed_results,
        )
        retrieval_duration_ms = int((time.time() - retrieval_start) * 1000)

        enrichment_start = time.time()
        enriched_data = await asyncio.to_thread(
            enrichment_service.enrich,
            live_source_results,
            processed_results,
        )
        enrichment_duration_ms = int((time.time() - enrichment_start) * 1000)

        freshness_analysis = freshness_detection_service.analyze(processed_results, enriched_data)
        recommended_changes = recommendation_service.recommend(freshness_analysis, enriched_data)

        total_time_ms = int((time.time() - start_time) * 1000)
        summary = self._build_summary(processed_results)
        provider_set = {
            entry["result"].metadata.get("ai_provider_used")
            for entry in processed_results
            if entry.get("result") and entry["result"].metadata
        }
        provider_used = (
            next(iter(provider_set))
            if len(provider_set) == 1
            else "mixed" if provider_set else "unknown"
        )
        fallback_triggered = any(
            entry["result"].metadata.get("ai_provider_fallback")
            for entry in processed_results
            if entry.get("result") and entry["result"].metadata
        )

        review_required = False
        review_candidates = []
        if candidate_matches:
            top_candidate_confidence = float(candidate_matches[0].get("confidence", 0.0))
            review_required = top_candidate_confidence < 0.90
        elif live_source_results:
            review_required = True

        if review_required:
            review_candidates = live_source_results[:5]

        metadata = {
            "request_id": request_id,
            "processing_stages": [
                "input_detection",
                "parser_selection",
                "ai_understanding",
                "schema_inference",
                "normalization",
                "relationship_inference",
                "confidence",
                "source_discovery",
                "candidate_resolution",
                "live_source_retrieval",
                "enrichment",
                "freshness_detection",
                "recommendation_generation",
            ],
            "source_discovery_duration_ms": source_discovery_duration_ms,
            "candidate_resolution_duration_ms": candidate_resolution_duration_ms,
            "live_retrieval_duration_ms": retrieval_duration_ms,
            "enrichment_duration_ms": enrichment_duration_ms,
            "total_request_time_ms": total_time_ms,
            "priority_sources": settings.SOURCE_DISCOVERY_PRIORITIES,
            "ai_provider_used": provider_used,
            "ai_fallback_triggered": fallback_triggered,
        }

        # Build a sanitized, user-facing warning if any AI enrichment problems occurred
        user_warnings = []
        for entry in processed_results:
            try:
                if entry.get("result") and getattr(entry["result"].metadata, "get", None):
                    # result.metadata may be a dict-like Pydantic object
                    md = entry["result"].metadata
                    if isinstance(md, dict) and md.get("ai_warning"):
                        user_warnings.append(md.get("ai_warning"))
            except Exception:
                continue

        if fallback_triggered:
            metadata["user_warning"] = "Fallback provider used"
        elif user_warnings:
            # Dedupe and pick first friendly message
            metadata["user_warning"] = list(dict.fromkeys(user_warnings))[0]

        return UnifiedProcessResponse(
            request_id=request_id,
            total_inputs=len(processed_results),
            processed_results=[ProcessedResultEntry(**result) for result in processed_results],
            summary=summary,
            source_candidates=source_candidates,
            candidate_matches=candidate_matches,
            live_source_results=live_source_results,
            enriched_data=enriched_data,
            freshness_analysis=freshness_analysis,
            recommended_changes=recommended_changes,
            review_required=review_required,
            review_candidates=review_candidates,
            metadata=metadata,
        )

    async def _extract_payload(
        self,
        request: Request,
        json_payload: Optional[str],
    ) -> Optional[Any]:
        if json_payload:
            try:
                return json.loads(json_payload)
            except json.JSONDecodeError as exc:
                raise HTTPException(status_code=400, detail=f"Invalid JSON payload: {str(exc)}")

        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                payload = await request.json()
                return payload
            except Exception:
                return None

        return None

    def _build_inputs(
        self,
        files: Optional[List[UploadFile]],
        raw_text: Optional[str],
        payload: Optional[Any],
    ) -> List[Dict[str, Any]]:
        inputs: List[Dict[str, Any]] = []

        if files:
            for file in files:
                inputs.append({
                    "type": "file",
                    "file": file,
                    "input_name": file.filename or "uploaded_file",
                })

        if payload is not None:
            if isinstance(payload, dict) and "text" in payload and len(payload) == 1 and not raw_text:
                raw_text = str(payload.get("text", ""))
                payload = None
            else:
                inputs.append({
                    "type": "json",
                    "payload": payload,
                    "input_name": "structured_json",
                })

        if raw_text:
            inputs.append({
                "type": "text",
                "text": raw_text,
                "input_name": "raw_text",
            })

        return inputs

    def _parse_user_defined_sources(self, raw_sources: Optional[str]) -> List[str]:
        if not raw_sources:
            return []
        trimmed = raw_sources.strip()
        if not trimmed:
            return []

        try:
            result = json.loads(trimmed)
            if isinstance(result, list):
                return [str(item).strip() for item in result if str(item).strip()]
        except json.JSONDecodeError:
            pass

        if "," in trimmed:
            return [item.strip() for item in trimmed.split(",") if item.strip()]

        return [trimmed]

    async def _process_file(self, file: UploadFile) -> Dict[str, Any]:
        start_time = time.time()
        file_name = file.filename or "uploaded_file"
        status = "failed"
        result = None
        error = None

        # Debug: log file processing start
        logger.info(f"Starting file processing for {file_name}")

        try:
            content = await file.read()
            file_size = len(content)
            is_valid, error_message = upload_service.validate_file_metadata(
                filename=file_name,
                file_size=file_size,
                max_size_mb=settings.MAX_UPLOAD_SIZE_MB,
            )
            if not is_valid:
                raise ValueError(error_message)

            file_format = upload_service.detect_file_format(file_name)
            parsed_summary = parser_service.parse(content, file_format)
            logger.info(f"Parsed file {file_name} successfully")

            # Create upload record early and persist parse summary so frontend can render dataset
            try:
                upload_record = upload_service.create_upload_record(filename=file_name, file_size=len(content), format=file_format)
                upload_service.attach_parse_summary(upload_record['id'], parsed_summary)
                upload_service.update_upload_status(upload_record['id'], 'processed')
                logger.info(f"Upload record created {upload_record['id']} for {file_name} before AI enrichment")
            except Exception as e:
                logger.warning(f"Failed to create upload record early for {file_name}: {e}")

            if file_format in ["csv", "xlsx", "xls", "json"]:
                ai_content = f"Columns: {', '.join(parsed_summary.get('columns', [])[:10])}\nData columns found."
            else:
                ai_content = parsed_summary.get("text_preview", "")

            # Build a minimal unified schema so dataset can be considered created even if AI fails
            from app.models.unified_schemas import UnifiedSchema
            unified = UnifiedSchema(
                entity_type=None,
                dataset_type=file_format,
                primary_entity=None,
                attributes={},
                schema=[],
                relationships=[],
                confidence={},
                provenance={},
                metadata={
                    "ai_model": getattr(settings, "GEMINI_MODEL", ""),
                    "processing_stages": ["parse"],
                    "parser_used": file_name.split('.')[-1].lower() if file_name else None,
                    "ai_status": "pending",
                    "parsed_summary": parsed_summary,
                },
            )

            # Attempt AI understanding and downstream enrichment, but do not fail upload if AI errors occur
            try:
                processed_input = ai_understanding_service.understand_input(
                    content=ai_content,
                    input_type=file_format,
                    raw_input=file_name,
                )
                # proceed with schema inference and normalization
                schema_result = None
                try:
                    schema_result = schema_inference_service.infer_schema(
                        parsed_summary=parsed_summary,
                        dataset_name=file_name,
                    )
                except Exception:
                    schema_result = None

                unified = normalization_service.normalize(
                    processed_input=processed_input,
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
                unified.metadata.setdefault("processing_stages", []).extend([
                    "ai_understanding",
                    "schema_inference",
                    "normalization",
                    "relationship_inference",
                    "confidence",
                ])
                unified.metadata["ai_model"] = getattr(settings, "GEMINI_MODEL", "")
                unified.metadata["ai_status"] = "succeeded"
                unified.metadata["parsed_summary"] = parsed_summary
                status = "success"
                result = unified
            except Exception as exc:
                # AI failed — log, mark ai_status, but keep dataset creation successful
                # Log detailed exception server-side, but do NOT expose internals to clients
                logger.warning("AI enrichment failed for %s: %s", file_name, exc, exc_info=True)
                unified.metadata["ai_status"] = "failed"
                # Provide a sanitized, user-facing hint only
                unified.metadata["ai_warning"] = "AI enrichment temporarily unavailable"
                # Keep overall status as success since dataset is created and parsed
                status = "success"
                result = unified
                # continue without raising
                
        except Exception as exc:
            # Parsing or early-stage error — log details but return a sanitized message to the client
            logger.error("Processing error for %s: %s", file_name, exc, exc_info=True)
            error = "File processing failed"

        processed_time = int((time.time() - start_time) * 1000)
        return {
            "input_name": file_name,
            "input_type": "file",
            "status": status,
            "result": result,
            "error": error,
            "processing_time_ms": processed_time,
            "source": "uploaded_file",
            "metadata": {"parser_used": file_name.split(".")[-1].lower() if file_name else None},
        }

    def _process_json(self, payload: Any) -> Dict[str, Any]:
        start_time = time.time()
        status = "failed"
        result = None
        error = None

        try:
            raw_payload = json.dumps(payload, ensure_ascii=False)[:2000]
            processed_input = ai_understanding_service.understand_input(
                content=raw_payload,
                input_type="json",
                raw_input=raw_payload,
            )
            schema_result = None
            try:
                schema_result = schema_inference_service.infer_schema(payload=payload)
            except Exception:
                schema_result = None

            unified = normalization_service.normalize(
                processed_input=processed_input,
                parsed_summary=None,
                schema_result=schema_result,
            )
            rels = relationship_inference_service.infer_relationships(unified.schema)
            unified.relationships = rels
            confs, prov = confidence_service.generate(unified.schema, [r.dict() for r in rels])
            unified.confidence = confs
            unified.provenance = prov
            unified.metadata.setdefault("processing_stages", []).extend([
                "ai_understanding",
                "schema_inference",
                "normalization",
                "relationship_inference",
                "confidence",
            ])
            unified.metadata["ai_model"] = getattr(settings, "GEMINI_MODEL", "")
            status = "success"
            result = unified
        except Exception as exc:
            logger.error("JSON processing error: %s", exc, exc_info=True)
            error = "Processing failed"

        processed_time = int((time.time() - start_time) * 1000)
        return {
            "input_name": "structured_json",
            "input_type": "json",
            "status": status,
            "result": result,
            "error": error,
            "processing_time_ms": processed_time,
            "source": "structured_json",
            "metadata": {},
        }

    def _process_text(self, text: str) -> Dict[str, Any]:
        start_time = time.time()
        status = "failed"
        result = None
        error = None

        try:
            processed_input = ai_understanding_service.understand_input(
                content=text,
                input_type="text",
                raw_input=text,
            )
            parsed_summary = {"text_preview": text, "format": "text"}
            schema_result = None
            try:
                schema_result = schema_inference_service.infer_schema(parsed_summary=parsed_summary)
            except Exception:
                schema_result = None

            unified = normalization_service.normalize(
                processed_input=processed_input,
                parsed_summary=parsed_summary,
                schema_result=schema_result,
            )
            rels = relationship_inference_service.infer_relationships(unified.schema)
            unified.relationships = rels
            confs, prov = confidence_service.generate(unified.schema, [r.dict() for r in rels])
            unified.confidence = confs
            unified.provenance = prov
            unified.metadata.setdefault("processing_stages", []).extend([
                "ai_understanding",
                "schema_inference",
                "normalization",
                "relationship_inference",
                "confidence",
            ])
            unified.metadata["ai_model"] = getattr(settings, "GEMINI_MODEL", "")
            status = "success"
            result = unified
        except Exception as exc:
            logger.error("Text processing error: %s", exc, exc_info=True)
            error = "Processing failed"

        processed_time = int((time.time() - start_time) * 1000)
        return {
            "input_name": "raw_text",
            "input_type": "text",
            "status": status,
            "result": result,
            "error": error,
            "processing_time_ms": processed_time,
            "source": "raw_text",
            "metadata": {},
        }

    def _build_summary(self, processed_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        successful = [r for r in processed_results if r.get("status") == "success"]
        dataset_types = list({r["result"].dataset_type for r in successful if r.get("result") and r["result"].dataset_type})
        entity_types = list({r["result"].entity_type for r in successful if r.get("result") and r["result"].entity_type})

        return {
            "total_inputs": len(processed_results),
            "successful_inputs": len(successful),
            "failed_inputs": len([r for r in processed_results if r.get("status") != "success"]),
            "dataset_types": dataset_types,
            "entity_types": entity_types,
        }


process_gateway_service = ProcessGatewayService()
