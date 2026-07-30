"""
Schemas for Partial Scrape planning.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


PartialScrapeStatus = Literal["supported", "needs_clarification", "unsupported"]


class PartialScrapePlannerMetadata(BaseModel):
    planner_version: str = Field(..., description="Version of the planner logic used for this plan.")
    planned_at: datetime = Field(default_factory=datetime.utcnow, description="UTC timestamp for the plan.")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Planner confidence score.")
    model_name: Optional[str] = Field(default=None, description="Planner implementation used to generate the plan.")
    provider_used: Optional[str] = Field(default=None, description="Planner provider used to generate the plan.")


class PartialScrapeExecutionPlan(BaseModel):
    source_name: str = Field(..., description="User-facing source name.")
    source_key: str = Field(..., description="Normalized capability key for the source.")
    raw_request: str = Field(..., description="Original natural-language user request.")
    normalized_request: str = Field(..., description="Planner-normalized request summary.")
    execution_strategy: str = Field(..., description="High-level execution strategy for the bot.")
    supported_filters: Dict[str, Any] = Field(default_factory=dict, description="Bot-supported structured filters.")
    include_terms: List[str] = Field(default_factory=list, description="Inclusion keywords or terms.")
    exclude_terms: List[str] = Field(default_factory=list, description="Exclusion keywords or terms.")
    url_hints: List[str] = Field(default_factory=list, description="Seed URLs or page hints.")
    file_types: List[str] = Field(default_factory=list, description="Requested file types, if any.")
    crawl_limits: Dict[str, Any] = Field(default_factory=dict, description="Limits such as depth, pages, or dates.")
    unsupported_constraints: List[str] = Field(default_factory=list, description="Constraints the current bot cannot honor.")
    clarification_required: List[str] = Field(default_factory=list, description="Follow-up questions needed before execution.")
    adapter_kind: str = Field(..., description="Adapter family used to translate the plan into scraper inputs.")
    adapter_payload: Dict[str, Any] = Field(default_factory=dict, description="Thin adapter payload for the existing scraper.")


class PartialScrapePlanFeedback(BaseModel):
    status: PartialScrapeStatus = Field(..., description="Planner decision for the request.")
    execution_summary: str = Field(..., description="Human-readable summary of the planned execution.")
    explanation: Optional[str] = Field(default=None, description="Additional explanation for unsupported or ambiguous requests.")
    clarification_required: List[str] = Field(default_factory=list, description="Questions that need user clarification.")
    unsupported_reason: Optional[str] = Field(default=None, description="Reason the request cannot be fully honored.")


class PartialScrapePlanResult(BaseModel):
    planner_metadata: PartialScrapePlannerMetadata
    feedback: PartialScrapePlanFeedback
    execution_plan: PartialScrapeExecutionPlan

    class Config:
        json_schema_extra = {
            "example": {
                "planner_metadata": {
                    "planner_version": "partial-scrape-planner-v1",
                    "planned_at": "2026-06-30T00:00:00Z",
                    "confidence": 0.92,
                    "model_name": "heuristic",
                    "provider_used": "heuristic",
                },
                "feedback": {
                    "status": "supported",
                    "execution_summary": "Scrape WebMD physicians matching cardiology in California.",
                    "explanation": None,
                    "clarification_required": [],
                    "unsupported_reason": None,
                },
                "execution_plan": {
                    "source_name": "Webmd",
                    "source_key": "webmd",
                    "raw_request": "cardiologists in California accepting new patients",
                    "normalized_request": "WebMD physicians with specialty cardiology in CA and accepting new patients",
                    "execution_strategy": "field_filter",
                    "supported_filters": {
                        "specialty": ["Cardiology"],
                        "state": ["CA"],
                        "accepting_new_patients": "Yes"
                    },
                    "include_terms": [],
                    "exclude_terms": [],
                    "url_hints": [],
                    "file_types": [],
                    "crawl_limits": {},
                    "unsupported_constraints": [],
                    "clarification_required": [],
                    "adapter_kind": "field_filter",
                    "adapter_payload": {
                        "filters": {
                            "specialty": ["Cardiology"],
                            "state": ["CA"],
                            "accepting_new_patients": "Yes"
                        }
                    }
                }
            }
        }
