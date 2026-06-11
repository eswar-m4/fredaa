"""
Schema inference request and response models for F.R.E.D.A.

This module defines the standardized schema representation used by the
Phase 4 inference engine.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class SchemaFieldInference(BaseModel):
    """Semantic mapping for a single dataset field."""

    original_field: str = Field(..., description="Original field name from the dataset")
    standardized_field: str = Field(..., description="Normalized internal field name")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence in the inferred mapping")
    category: str = Field(..., description="Semantic category or entity type of the field")
    reason: str = Field(..., description="Short reasoning for the inference decision")


class SchemaInferenceResult(BaseModel):
    """Unified schema inference result for dataset understanding."""

    dataset_type: str = Field(..., description="Inferred dataset type or purpose")
    primary_entity: str = Field(..., description="Primary entity represented in the dataset")
    schema: List[SchemaFieldInference] = Field(..., description="Field-level semantic mappings")
    confidence_score: float = Field(..., ge=0.0, le=1.0, description="Overall confidence in the inferred schema")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Processing metadata and observability details")

    class Config:
        json_schema_extra = {
            "example": {
                "dataset_type": "customer_contacts",
                "primary_entity": "person",
                "schema": [
                    {
                        "original_field": "cust_nm",
                        "standardized_field": "customer_name",
                        "confidence": 0.96,
                        "category": "person_attribute",
                        "reason": "Common CRM abbreviation for customer name"
                    }
                ],
                "confidence_score": 0.93,
                "metadata": {
                    "ai_model": "gemini-flash-latest",
                    "inference_method": "ai_schema_inference",
                    "processing_time_ms": 200,
                    "dataset_stats": {
                        "row_count": 10,
                        "column_count": 5
                    }
                }
            }
        }
