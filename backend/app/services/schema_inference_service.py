"""
Schema inference engine for F.R.E.D.A.

This service infers dataset schema meaning, field mappings, and dataset type
using AI-assisted reasoning. It supports uploaded files and structured JSON.
"""

import json
import re
import time
from typing import Any, Dict, List, Optional

from app.config import settings
from app.core.logger import setup_logger
from app.models.parsed_schemas import ParsedFileSummary
from app.models.schema_inference_schemas import SchemaInferenceResult, SchemaFieldInference
from app.services.ai_provider import AIProvider

logger = setup_logger(__name__)

COMMON_FIELD_MAP = {
    "cust_nm": "customer_name",
    "custname": "customer_name",
    "customername": "customer_name",
    "ph_no": "phone_number",
    "phone_no": "phone_number",
    "phone": "phone_number",
    "mailid": "email",
    "email_address": "email",
    "cmp": "company",
    "org": "organization",
    "emp_name": "employee_name",
    "empid": "employee_id",
    "invoice_no": "invoice_number",
    "inv_no": "invoice_number",
    "amt_due": "amount_due",
    "due_dt": "due_date",
}

CATEGORY_MAP = {
    "name": "person_attribute",
    "email": "contact_attribute",
    "phone": "contact_attribute",
    "company": "organization",
    "invoice": "financial",
    "amount": "financial",
    "date": "temporal",
    "address": "location",
}


class SchemaInferenceService:
    """Service that infers dataset schema semantics and structure."""

    def __init__(self) -> None:
        self.provider = AIProvider(api_key=settings.GEMINI_API_KEY, model=settings.GEMINI_MODEL)
        if not self.provider.client:
            logger.warning("GEMINI_API_KEY not configured or provider unavailable. Schema inference will be limited.")

    def infer_schema(
        self,
        payload: Optional[Any] = None,
        parsed_summary: Optional[Dict[str, Any]] = None,
        dataset_name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> SchemaInferenceResult:
        """Infer schema semantics from structured input or parsed file summary."""
        start_time = time.time()

        input_state = self._normalize_input(payload=payload, parsed_summary=parsed_summary)

        if not input_state["columns"] and not input_state["sample_records"]:
            raise ValueError("No structured dataset information available for schema inference.")

        prompt = self._build_prompt(
            columns=input_state["columns"],
            sample_records=input_state["sample_records"],
            dataset_name=dataset_name or input_state["dataset_name"],
            description=description,
        )

        raw_response = self._call_gemini_api(prompt)
        analysis = self._parse_ai_response(raw_response)

        result = self._build_result(analysis, input_state, int((time.time() - start_time) * 1000))
        return result

    def _normalize_input(
        self,
        payload: Optional[Any] = None,
        parsed_summary: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Normalize the input into columns, sample records, and dataset statistics."""
        if parsed_summary:
            summary = parsed_summary.copy()
            columns = summary.get("columns") or []
            sample = summary.get("sample") or []
            dataset_name = summary.get("format")
            row_count = summary.get("row_count")
            column_count = len(columns)

            if not columns and not sample and summary.get("text_preview"):
                text_preview = summary.get("text_preview")
                columns = ["text_preview"]
                sample = [{"text_preview": text_preview}]
                column_count = 1

            return {
                "columns": [str(c) for c in columns],
                "sample_records": sample,
                "dataset_name": dataset_name,
                "row_count": row_count,
                "column_count": column_count,
            }

        if payload is None:
            return {"columns": [], "sample_records": [], "dataset_name": None, "row_count": None, "column_count": 0}

        if isinstance(payload, list):
            records = [self._normalize_record(r) for r in payload if isinstance(r, dict)]
            columns = self._collect_columns(records)
            return {
                "columns": columns,
                "sample_records": records[:5],
                "dataset_name": "json_records",
                "row_count": len(records),
                "column_count": len(columns),
            }

        if isinstance(payload, dict):
            if "records" in payload and isinstance(payload["records"], list):
                return self._normalize_input(payload["records"])
            if "parsed_summary" in payload and isinstance(payload["parsed_summary"], dict):
                return self._normalize_input(parsed_summary=payload["parsed_summary"])
            if "columns" in payload and isinstance(payload["columns"], list):
                sample = payload.get("sample", [])
                return {
                    "columns": [str(c) for c in payload["columns"]],
                    "sample_records": [self._normalize_record(r) for r in sample if isinstance(r, dict)],
                    "dataset_name": payload.get("dataset_name", "json_columns"),
                    "row_count": len(sample) if sample else None,
                    "column_count": len(payload["columns"]),
                }
            if self._is_partial_record(payload):
                record = self._normalize_record(payload)
                columns = list(record.keys())
                return {
                    "columns": columns,
                    "sample_records": [record],
                    "dataset_name": "partial_record",
                    "row_count": 1,
                    "column_count": len(columns),
                }

        raise ValueError("Unsupported structured JSON payload for schema inference.")

    def _is_partial_record(self, payload: Dict[str, Any]) -> bool:
        return all(not isinstance(v, (list, dict)) for v in payload.values())

    def _normalize_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        return {str(k): v for k, v in record.items()}

    def _collect_columns(self, records: List[Dict[str, Any]]) -> List[str]:
        columns = []
        for record in records:
            for key in record.keys():
                if key not in columns:
                    columns.append(key)
        return columns

    def _build_prompt(
        self,
        columns: List[str],
        sample_records: List[Dict[str, Any]],
        dataset_name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> str:
        dataset_label = dataset_name or "unknown dataset"
        description_text = f"Dataset description: {description}\n" if description else ""
        sample_text = "" if not sample_records else json.dumps(sample_records[:3], indent=2)

        prompt = (
            "You are a schema inference engine. Analyze the dataset metadata below and infer its purpose, "
            "the primary entity, and a standardized field mapping for each column. "
            "Return valid JSON only, with keys: dataset_type, primary_entity, confidence_score, schema. "
            "Each schema item must include original_field, standardized_field, confidence, category, reason.\n\n"
            f"Dataset name: {dataset_label}\n"
            f"{description_text}"
            f"Columns: {', '.join(columns)}\n"
            f"Row sample: {sample_text}\n\n"
            "Do not include markdown formatting. Keep values concise. "
            "Use standardized internal names for fields such as customer_name, phone_number, email, company, invoice_number, amount_due, due_date."
        )

        return prompt

    def _call_gemini_api(self, prompt: str) -> str:
        if not self.provider.client:
            raise ValueError("AI provider not configured for schema inference. Set GEMINI_API_KEY.")

        logger.info("Calling Gemini for schema inference")
        return self.provider.generate(prompt, timeout=settings.AI_REQUEST_TIMEOUT_SEC, temperature=0.2)

    def _parse_ai_response(self, response_text: str) -> Dict[str, Any]:
        cleaned = response_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[6:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        return json.loads(cleaned.strip())

    def _build_result(
        self,
        analysis: Dict[str, Any],
        input_state: Dict[str, Any],
        processing_time_ms: int,
    ) -> SchemaInferenceResult:
        schema_items = []
        for field in analysis.get("schema", []):
            original = str(field.get("original_field", ""))
            standardized = field.get("standardized_field") or self._standardize_field_name(original)
            confidence = float(field.get("confidence", 0.0))
            category = field.get("category") or self._infer_category(original)
            reason = field.get("reason") or "Inferred from field naming and dataset context."
            schema_items.append(
                SchemaFieldInference(
                    original_field=original,
                    standardized_field=standardized,
                    confidence=confidence,
                    category=category,
                    reason=reason,
                )
            )

        dataset_type = analysis.get("dataset_type") or "unknown"
        primary_entity = analysis.get("primary_entity") or "unknown"
        confidence_score = float(analysis.get("confidence_score", 0.0))

        metadata = {
            "ai_model": settings.GEMINI_MODEL,
            "inference_method": "ai_schema_inference",
            "processing_time_ms": processing_time_ms,
            "dataset_stats": {
                "row_count": input_state.get("row_count"),
                "column_count": input_state.get("column_count"),
            },
        }

        return SchemaInferenceResult(
            dataset_type=dataset_type,
            primary_entity=primary_entity,
            schema=schema_items,
            confidence_score=confidence_score,
            metadata=metadata,
        )

    def _standardize_field_name(self, field_name: str) -> str:
        normalized = field_name.strip().lower()
        normalized = re.sub(r"[\s\-\.]+", "_", normalized)
        normalized = re.sub(r"[^a-z0-9_]+", "", normalized)
        if normalized in COMMON_FIELD_MAP:
            return COMMON_FIELD_MAP[normalized]
        return normalized

    def _infer_category(self, field_name: str) -> str:
        lower = field_name.strip().lower()
        for key, category in CATEGORY_MAP.items():
            if key in lower:
                return category
        return "unknown"


schema_inference_service = SchemaInferenceService()
