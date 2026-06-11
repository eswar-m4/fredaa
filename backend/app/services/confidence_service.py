"""
Confidence and provenance generator for inferred schema and relationships.
"""
import time
from typing import Any, Dict, List, Optional

from app.core.logger import setup_logger
from app.models.schema_inference_schemas import SchemaFieldInference

logger = setup_logger(__name__)


class ConfidenceService:
    def generate(self, schema_items: List[Dict[str, Any]], relationships: List[Dict[str, Any]], sources: Dict[str, str] = None) -> (Dict[str, float], Dict[str, Dict[str, str]]):
        start = time.time()
        confidences: Dict[str, float] = {}
        provenance: Dict[str, Dict[str, str]] = {}

        sources = sources or {}

        for item in schema_items:
            std = item.get("standardized_field")
            conf = float(item.get("confidence", 0.5)) if item.get("confidence") is not None else 0.5
            confidences[std] = round(conf, 3)
            provenance[std] = {
                "source": sources.get(std, "ai/schema_inference"),
                "reason": item.get("category", "Inferred by schema mapping")
            }

        # add relationship confidences
        for rel in relationships:
            key = rel.get("source_field")
            if key and key not in confidences:
                confidences[key] = float(rel.get("confidence", 0.5))
                provenance[key] = {"source": "relationship_inference", "reason": rel.get("relationship_type", "related")}

        logger.debug(f"Generated confidence for {len(confidences)} items in {int((time.time()-start)*1000)}ms")
        return confidences, provenance


# Global instance
confidence_service = ConfidenceService()
