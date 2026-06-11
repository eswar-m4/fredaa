"""
AI understanding and analysis schemas for F.R.E.D.A.
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime


class ProcessedInput(BaseModel):
    """
    Unified schema for all AI-processed inputs.
    
    This is the normalized output that represents how F.R.E.D.A
    understands any input (raw text, file, attribute, etc).
    """

    input_type: str = Field(
        ...,
        description="Type of input: 'text', 'csv', 'xlsx', 'pdf', 'docx', 'txt'",
    )
    entity_type: Optional[str] = Field(
        None, description="Inferred entity type (e.g., 'company', 'person', 'email', 'url')"
    )
    raw_input: str = Field(..., description="Original input provided by user")
    content: str = Field(
        ..., description="Extracted/processed content for analysis"
    )
    normalized_data: Dict[str, Any] = Field(
        default_factory=dict,
        description="Structured attributes extracted from input",
    )
    summary: str = Field(..., description="Human-readable summary of the input")
    confidence_score: float = Field(
        ..., ge=0.0, le=1.0, description="Confidence in AI understanding (0.0-1.0)"
    )
    attributes: Dict[str, Any] = Field(
        default_factory=dict, description="Key-value attributes extracted"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Additional processing metadata"
    )
    processing_time_ms: int = Field(
        ..., description="Time taken for processing in milliseconds"
    )
    timestamp: datetime = Field(
        default_factory=datetime.utcnow, description="Processing timestamp"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "input_type": "text",
                "entity_type": "company",
                "raw_input": "Acme Corporation",
                "content": "Acme Corporation",
                "normalized_data": {"name": "Acme Corporation"},
                "summary": "Recognized as a technology company specializing in AI.",
                "confidence_score": 0.95,
                "attributes": {"name": "Acme Corporation", "industry": "technology", "type": "organization"},
                "metadata": {"source": "gemini_api"},
                "processing_time_ms": 450,
                "timestamp": "2026-05-22T10:30:00",
            }
        }


class ProcessInputRequest(BaseModel):
    """Request schema for /process-input endpoint (text-only)."""

    text: str = Field(..., description="Raw text input to process", min_length=1)

    class Config:
        json_schema_extra = {
            "example": {
                "text": "Acme Corporation is a leading AI research company."
            }
        }
