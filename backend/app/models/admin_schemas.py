"""
Schemas for admin authentication and workflow request auditing.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    role: str = Field(..., pattern="^(user|admin)$")


class SignupRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    display_name: Optional[str] = Field(default=None, min_length=1)


class SessionInfo(BaseModel):
    session_token: str
    username: str
    user_id: str
    display_name: str
    role: str
    created_at: datetime
    updated_at: datetime
    expires_at: datetime
    last_seen_at: datetime


class AdminAuditRequestRow(BaseModel):
    id: str
    job_id: str
    request_type: str
    source_kind: Optional[str] = None
    source: Optional[str] = None
    dataset_name: Optional[str] = None
    mode: Optional[str] = None
    scope: Optional[str] = None
    user_id: Optional[str] = None
    username: Optional[str] = None
    role: Optional[str] = None
    display_name: Optional[str] = None
    raw_payload: Dict[str, Any] = Field(default_factory=dict)
    planner_json: Dict[str, Any] = Field(default_factory=dict)
    planner_status: Optional[str] = None
    request_status: Optional[str] = None
    status_label: Optional[str] = None
    job_status: Optional[str] = None
    status_reason: Optional[str] = None
    execution_metadata: Dict[str, Any] = Field(default_factory=dict)
    timeline: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    investigated: bool = False
    investigated_at: Optional[datetime] = None
    investigated_by: Optional[str] = None
    investigated_notes: Optional[str] = None


class AdminAuditSummary(BaseModel):
    total_requests: int
    running: int
    completed: int
    failed: int
    unsupported: int
    needs_clarification: int
    awaiting_review: int
    refreshing: int
