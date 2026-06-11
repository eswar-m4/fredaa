"""
Normalization service: maps inferred schema/items to the unified internal structure.
"""
import time
from typing import Any, Dict, List, Optional

from app.core.logger import setup_logger
from app.models.unified_schemas import UnifiedSchema
from app.models.schema_inference_schemas import SchemaInferenceResult, SchemaFieldInference
from app.services.schema_inference_service import COMMON_FIELD_MAP
from app.config import settings

logger = setup_logger(__name__)


class NormalizationService:
    def __init__(self) -> None:
        self.field_map = COMMON_FIELD_MAP.copy()

    def normalize(
        self,
        processed_input: Optional[Any] = None,
        parsed_summary: Optional[Dict[str, Any]] = None,
        schema_result: Optional[SchemaInferenceResult] = None,
        dataset_name: Optional[str] = None,
    ) -> UnifiedSchema:
        start = time.time()

        # Base unified object
        unified = UnifiedSchema()

        # Populate high-level dataset info
        if schema_result:
            unified.dataset_type = schema_result.dataset_type
            unified.primary_entity = schema_result.primary_entity
        if processed_input:
            unified.entity_type = getattr(processed_input, "entity_type", None)

        # Build attributes from processed input normalized_data and parsed sample
        attributes = {}
        if processed_input and getattr(processed_input, "normalized_data", None):
            attributes.update(processed_input.normalized_data)

        # Normalize schema list
        schema_list = []
        if schema_result and schema_result.schema:
            for item in schema_result.schema:
                orig = item.original_field
                std = item.standardized_field or self._standardize_field_name(orig)
                confidence = float(item.confidence or 0.0)
                category = item.category
                schema_list.append({
                    "original_field": orig,
                    "standardized_field": std,
                    "confidence": confidence,
                    "category": category,
                })
                # seed attributes with first sample if available
                if parsed_summary and parsed_summary.get("sample"):
                    first = parsed_summary["sample"][0]
                    if orig in first:
                        attributes[std] = first[orig]

        # If no schema_result, attempt to map parsed_summary columns
        if not schema_list and parsed_summary and parsed_summary.get("columns"):
            columns = parsed_summary.get("columns", [])
            for c in columns:
                std = self._standardize_field_name(c)
                schema_list.append({"original_field": c, "standardized_field": std, "confidence": 0.5, "category": "unknown"})

        unified.schema = schema_list
        unified.attributes = attributes

        unified.metadata["ai_model"] = settings.GEMINI_MODEL
        unified.metadata["normalization_time_ms"] = int((time.time() - start) * 1000)
        unified.metadata.setdefault("processing_stages", []).append("normalization")

        return unified

    def _standardize_field_name(self, name: str) -> str:
        n = (name or "").lower()
        if n in self.field_map:
            return self.field_map[n]
        # heuristics
        if n.endswith("_id"):
            return n[:-3]
        if any(k in n for k in ["email", "mail"]):
            return "email"
        if any(k in n for k in ["name", "full_name", "cust", "emp"]):
            return "name"
        if any(k in n for k in ["phone", "ph_no", "tel"]):
            return "phone"
        return n


# Global instance
normalization_service = NormalizationService()
