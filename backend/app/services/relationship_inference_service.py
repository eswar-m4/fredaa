"""
Relationship inference heuristics and AI-backed reasoning.
"""
import time
from typing import Any, Dict, List, Optional

from app.core.logger import setup_logger
from app.models.schema_inference_schemas import SchemaFieldInference
from app.models.unified_schemas import RelationshipInference

logger = setup_logger(__name__)


class RelationshipInferenceService:
    def infer_relationships(self, schema: List[Dict[str, Any]], sample_records: Optional[List[Dict[str, Any]]] = None) -> List[RelationshipInference]:
        start = time.time()
        relationships: List[RelationshipInference] = []

        # Heuristic 1: fields ending with _id likely reference other entities
        for item in schema:
            orig = item.get("original_field")
            std = item.get("standardized_field") or orig
            if isinstance(orig, str) and orig.lower().endswith("_id"):
                target = std[:-3] if std.endswith("_id") else std
                rel = RelationshipInference(
                    source_field=orig,
                    target_entity=target,
                    relationship_type="references",
                    confidence=0.9,
                )
                relationships.append(rel)

        # Heuristic 2: pluralized field names probably denote child collections (orders, invoices)
        for item in schema:
            orig = item.get("original_field")
            if orig and orig.endswith("s") and not orig.endswith("ss"):
                rel = RelationshipInference(
                    source_field=orig,
                    target_entity=orig[:-1],
                    relationship_type="contains_many",
                    confidence=0.6,
                )
                relationships.append(rel)

        # Heuristic 3: detect manager/parent fields
        for item in schema:
            orig = item.get("original_field", "").lower()
            if "manager" in orig or "supervisor" in orig:
                relationships.append(RelationshipInference(
                    source_field=item.get("original_field"),
                    target_entity="employee",
                    relationship_type="manager_of",
                    confidence=0.75,
                ))

        logger.debug(f"Inferred {len(relationships)} relationships in {int((time.time()-start)*1000)}ms")
        return relationships


# Global instance
relationship_inference_service = RelationshipInferenceService()
