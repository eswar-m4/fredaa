"""
Parsed file metadata schemas for F.R.E.D.A.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict


class ParsedFileSummary(BaseModel):
    """Summary metadata returned after file parsing."""

    format: str = Field(..., description="Detected file format")
    row_count: Optional[int] = Field(None, description="Number of data rows parsed")
    column_count: Optional[int] = Field(None, description="Number of columns parsed")
    columns: Optional[List[str]] = Field(None, description="Parsed field names")
    page_count: Optional[int] = Field(None, description="Number of PDF pages parsed")
    paragraph_count: Optional[int] = Field(None, description="Number of DOCX paragraphs parsed")
    line_count: Optional[int] = Field(None, description="Number of text lines parsed")
    text_length: Optional[int] = Field(None, description="Length of parsed text in characters")
    sample: Optional[List[Dict[str, Any]]] = Field(None, description="Sample records from parsed tabular data")
    text_preview: Optional[str] = Field(None, description="Short preview of extracted text")

    class Config:
        json_schema_extra = {
            "example": {
                "format": "csv",
                "row_count": 10,
                "column_count": 4,
                "columns": ["id", "name", "price", "date"],
                "sample": [{"id": "1", "name": "Acme", "price": "9.99", "date": "2026-05-21"}],
                "text_length": None,
                "text_preview": None
            }
        }
