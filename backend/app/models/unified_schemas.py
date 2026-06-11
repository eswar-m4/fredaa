"""
Unified schema models for F.R.E.D.A Phase 5-7

Defines the enterprise unified internal schema, relationship and provenance models.
"""
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional


class RelationshipInference(BaseModel):
    source_field: str = Field(..., description="Source field name")
    target_entity: str = Field(..., description="Target entity name")
    relationship_type: str = Field(..., description="Semantic relationship type")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence for the relationship")


class ProvenanceEntry(BaseModel):
    source: str = Field(..., description="Origin of the information (parser/AI/heuristic)")
    reason: str = Field(..., description="Short explanation of why this inference was made")


class UnifiedSchema(BaseModel):
    entity_type: Optional[str] = Field(None, description="High level entity type")
    dataset_type: Optional[str] = Field(None, description="Inferred dataset type")
    primary_entity: Optional[str] = Field(None, description="Primary entity in dataset")
    attributes: Dict[str, Any] = Field(default_factory=dict, description="Normalized key-value attributes")
    schema: List[Dict[str, Any]] = Field(default_factory=list, description="Field-level schema definitions")
    relationships: List[RelationshipInference] = Field(default_factory=list, description="Inferred relationships")
    confidence: Dict[str, float] = Field(default_factory=dict, description="Field/entity confidence scores")
    provenance: Dict[str, ProvenanceEntry] = Field(default_factory=dict, description="Provenance explanations")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Processing metadata and observability")

    class Config:
        schema_extra = {
            "example": {
                "entity_type": "organization",
                "dataset_type": "supplier_records",
                "primary_entity": "organization",
                "attributes": {"name": "Acme Supplies", "email": "sales@acme.com"},
                "schema": [{"original_field": "org", "standardized_field": "organization", "confidence": 0.92}],
                "relationships": [{"source_field": "manager_id", "target_entity": "employee", "relationship_type": "manager_of", "confidence": 0.89}],
                "confidence": {"organization": 0.92, "email": 0.95},
                "provenance": {"email": {"source": "parser", "reason": "Detected email pattern"}},
                "metadata": {"ai_model": "gemini", "processing_time_ms": 420, "processing_stages": ["parse","ai_understanding","schema_inference","normalization","relationship_inference","confidence"]}
            }
        }


class NormalizedFileEntry(BaseModel):
    file_name: str = Field(..., description="Original uploaded file name")
    status: str = Field(..., description="Processing status: success or failed")
    result: Optional[UnifiedSchema] = Field(None, description="Normalized schema result for successful files")
    error: Optional[str] = Field(None, description="Error details for failed file processing")
    processing_time_ms: Optional[int] = Field(None, description="Time taken to process this file")
    parser_used: Optional[str] = Field(None, description="Detected parser or file type used")
    ai_status: Optional[str] = Field(None, description="AI understanding status")


class MultiFileNormalizeResponse(BaseModel):
    total_files: int = Field(..., description="Total files received for normalization")
    processed_files: List[NormalizedFileEntry] = Field(..., description="Per-file normalization results")
    combined_summary: Dict[str, Any] = Field(default_factory=dict, description="Aggregated summary across all processed files")

    class Config:
        schema_extra = {
            "example": {
                "total_files": 2,
                "processed_files": [
                    {
                        "file_name": "crm.csv",
                        "status": "success",
                        "result": {
                            "entity_type": "organization",
                            "dataset_type": "customer_contacts",
                            "primary_entity": "person",
                            "attributes": {"name": "Acme Corporation"},
                            "schema": [{"original_field": "cust_nm", "standardized_field": "name", "confidence": 0.98}],
                            "relationships": [],
                            "confidence": {"name": 0.98},
                            "provenance": {"name": {"source": "ai/schema_inference", "reason": "Common CRM abbreviation"}},
                            "metadata": {"ai_model": "gemini", "processing_time_ms": 300, "processing_stages": ["parse","ai_understanding","schema_inference","normalization","relationship_inference","confidence"]}
                        },
                        "processing_time_ms": 300,
                        "parser_used": "csv",
                        "ai_status": "succeeded"
                    }
                ],
                "combined_summary": {
                    "total_entities": 1,
                    "dataset_types": ["customer_contacts"],
                    "processing_time_ms": 300
                }
            }
        }


class SourceCandidate(BaseModel):
    source_type: str = Field(..., description="Type of external source candidate")
    query: str = Field(..., description="Search query or URL representing the source candidate")
    priority: int = Field(..., description="Priority ranking for the source candidate")


class CandidateMatch(BaseModel):
    candidate_name: str = Field(..., description="Candidate entity name")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score for the candidate")
    reason: str = Field(..., description="Reason for the candidate match ranking")
    source_type: Optional[str] = Field(None, description="Source type associated with this candidate match")


class LiveSourceResult(BaseModel):
    title: str = Field(..., description="Title of the retrieved live source")
    url: str = Field(..., description="URL of the retrieved live source")
    snippet: str = Field(..., description="Snippet or summary from the live source")
    source_type: str = Field(..., description="Type of source retrieved")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence of the live source retrieval")


class EnrichedData(BaseModel):
    company_name: Optional[str] = Field(None, description="Discovered company name from enrichment")
    website: Optional[str] = Field(None, description="Resolved website URL from enrichment")
    possible_email: Optional[str] = Field(None, description="Discovered email address from enrichment")
    possible_phone: Optional[str] = Field(None, description="Discovered phone number from enrichment")
    role_title: Optional[str] = Field(None, description="Inferred role or title from enrichment")
    address: Optional[str] = Field(None, description="Discovered address from enrichment")
    social_profiles: List[str] = Field(default_factory=list, description="Discovered social profiles from enrichment")
    source_url: Optional[str] = Field(None, description="URL used to enrich data")
    description: Optional[str] = Field(None, description="Optional page description extracted during enrichment")


class FreshnessAnalysisEntry(BaseModel):
    field: str = Field(..., description="Field name evaluated for freshness")
    current_value: Optional[Any] = Field(None, description="Current existing value from the record")
    suggested_value: Optional[Any] = Field(None, description="New suggested value from enrichment")
    change_detected: bool = Field(..., description="Whether a freshness change was detected")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score for the freshness change")


class RecommendedChange(BaseModel):
    field: str = Field(..., description="Field that should be updated")
    current_value: Optional[Any] = Field(None, description="Existing value in the system")
    recommended_value: Optional[Any] = Field(None, description="Suggested value from the source")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score for the recommendation")
    source: Optional[str] = Field(None, description="Source URL or source reference for the recommendation")
    reason: str = Field(..., description="AI reasoning for the recommendation")


class ProcessedResultEntry(BaseModel):
    input_name: str = Field(..., description="Friendly name for the input source")
    input_type: str = Field(..., description="Type of input processed")
    status: str = Field(..., description="Processing status of this input")
    result: Optional[UnifiedSchema] = Field(None, description="Unified result when processing succeeded")
    error: Optional[str] = Field(None, description="Error details when processing failed")
    processing_time_ms: Optional[int] = Field(None, description="Time spent processing this input")
    source: Optional[str] = Field(None, description="Input source identifier")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Per-input metadata and observability")


class UnifiedProcessResponse(BaseModel):
    request_id: str = Field(..., description="Unique request identifier")
    total_inputs: int = Field(..., description="Total number of inputs processed")
    processed_results: List[ProcessedResultEntry] = Field(..., description="Per-input processing results")
    summary: Dict[str, Any] = Field(default_factory=dict, description="Aggregated summary across inputs")
    source_candidates: List[SourceCandidate] = Field(default_factory=list, description="Prepared external source discovery candidates")
    candidate_matches: List[CandidateMatch] = Field(default_factory=list, description="Ranked candidate entity suggestions")
    live_source_results: List[LiveSourceResult] = Field(default_factory=list, description="Live retrieved source search results")
    enriched_data: EnrichedData = Field(default_factory=EnrichedData, description="Structured enrichment extracted from live sources")
    freshness_analysis: List[FreshnessAnalysisEntry] = Field(default_factory=list, description="Freshness comparisons between current and enriched data")
    recommended_changes: List[RecommendedChange] = Field(default_factory=list, description="Enterprise-safe recommended updates")
    review_required: bool = Field(False, description="Whether the result requires human review due to low confidence")
    review_candidates: List[LiveSourceResult] = Field(default_factory=list, description="Source links returned for low-confidence review")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Gateway observability and stage metadata")

    class Config:
        schema_extra = {
            "example": {
                "request_id": "abc123",
                "total_inputs": 2,
                "processed_results": [
                    {
                        "input_name": "crm.csv",
                        "input_type": "file",
                        "status": "success",
                        "result": {
                            "entity_type": "organization",
                            "dataset_type": "customer_contacts",
                            "primary_entity": "person",
                            "attributes": {"name": "Acme Corporation"},
                            "schema": [{"original_field": "cust_nm", "standardized_field": "name", "confidence": 0.98}],
                            "relationships": [],
                            "confidence": {"name": 0.98},
                            "provenance": {"name": {"source": "ai/schema_inference", "reason": "Common CRM abbreviation"}},
                            "metadata": {"ai_model": "gemini", "processing_time_ms": 300, "processing_stages": ["parse","ai_understanding","schema_inference","normalization","relationship_inference","confidence"]}
                        },
                        "processing_time_ms": 300,
                        "source": "uploaded_file",
                        "metadata": {"parser_used": "csv"}
                    }
                ],
                "summary": {
                    "total_inputs": 2,
                    "successful_inputs": 2,
                    "failed_inputs": 0,
                    "dataset_types": ["customer_contacts"],
                    "entity_types": ["organization"]
                },
                "source_candidates": [
                    {"source_type": "linkedin", "query": "Acme Corporation LinkedIn", "priority": 1},
                    {"source_type": "company_website", "query": "Acme Corporation.com", "priority": 2}
                ],
                "candidate_matches": [
                    {"candidate_name": "Acme Corporation Inc", "confidence": 0.95, "reason": "Strong semantic similarity and source agreement.", "source_type": "company_website"}
                ],
                "metadata": {
                    "request_id": "abc123",
                    "processing_stages": ["input_detection","parser_selection","ai_understanding","schema_inference","normalization","relationship_inference","confidence","source_discovery","candidate_resolution"],
                    "source_discovery_duration_ms": 12,
                    "candidate_resolution_duration_ms": 18,
                    "total_request_time_ms": 512,
                    "priority_sources": ["linkedin","company_website","government_registry","business_directory","user_defined"]
                }
            }
        }
