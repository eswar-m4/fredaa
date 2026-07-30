"""
Pydantic schemas for request/response validation in F.R.E.D.A

This module defines all data models used for API request/response validation.
Pydantic provides automatic validation and serialization.
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime

from app.models.parsed_schemas import ParsedFileSummary


class HealthCheckResponse(BaseModel):
    """
    Schema for health check endpoint response.
    
    Attributes:
        status: Service status ("healthy", "degraded", etc.)
        version: API version
        timestamp: Response timestamp
        message: Optional status message
    """
    status: str = Field(..., description="Service status")
    version: str = Field(..., description="API version")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Response time")
    message: Optional[str] = Field(None, description="Optional status message")
    
    class Config:
        """Pydantic config"""
        json_schema_extra = {
            "example": {
                "status": "healthy",
                "version": "0.1.0",
                "timestamp": "2024-01-15T10:30:00",
                "message": "All systems operational"
            }
        }


class UploadResponse(BaseModel):
    """
    Schema for file upload response.
    
    Attributes:
        id: Unique identifier for uploaded data
        filename: Name of uploaded file
        file_size: Size of file in bytes
        format: Detected file format
        status: Upload status
        timestamp: Upload timestamp
        message: Optional status message
    """
    id: str = Field(..., description="Unique upload identifier")
    filename: str = Field(..., description="Uploaded filename")
    file_size: int = Field(..., description="File size in bytes")
    format: str = Field(..., description="File format (csv, xlsx, pdf, etc.)")
    status: str = Field(..., description="Upload status (pending, processing, etc.)")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Upload time")
    message: Optional[str] = Field(None, description="Optional status message")
    storage_path: Optional[str] = Field(None, description="Durable filesystem path for the uploaded file")
    parsed_summary: Optional[ParsedFileSummary] = Field(
        None,
        description="Summary metadata created by file parsing"
    )
    
    class Config:
        """Pydantic config"""
        json_schema_extra = {
            "example": {
                "id": "upload_12345",
                "filename": "data.csv",
                "file_size": 15360,
                "format": "csv",
                "status": "pending",
                "timestamp": "2024-01-15T10:30:00",
                "message": "File uploaded successfully"
            }
        }


class ErrorResponse(BaseModel):
    """
    Schema for error responses.
    
    Attributes:
        error: Error type/code
        message: Human-readable error message
        details: Optional detailed error information
        timestamp: Error timestamp
    """
    error: str = Field(..., description="Error type")
    message: str = Field(..., description="Error message")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional details")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Error time")
    
    class Config:
        """Pydantic config"""
        json_schema_extra = {
            "example": {
                "error": "VALIDATION_ERROR",
                "message": "Invalid file format",
                "details": {"allowed_formats": ["csv", "xlsx", "pdf"]},
                "timestamp": "2024-01-15T10:30:00"
            }
        }
