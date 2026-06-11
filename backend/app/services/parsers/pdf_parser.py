"""
PDF parser implementation for F.R.E.D.A.
"""

from io import BytesIO
from typing import Dict, Any

import pdfplumber
from app.services.parsers.base_parser import BaseParser
from app.core.logger import setup_logger

logger = setup_logger(__name__)


class PDFParser(BaseParser):
    """Parser for PDF files."""

    def parse(self, file_stream: BytesIO) -> Dict[str, Any]:
        file_stream.seek(0)

        with pdfplumber.open(file_stream) as pdf:
            pages = pdf.pages
            page_texts = [page.extract_text() or "" for page in pages]
            text = "\n".join(page_texts).strip()
            page_count = len(pages)
            text_length = len(text)

        logger.info("PDF file parsed successfully")
        return {
            "format": "pdf",
            "page_count": page_count,
            "text_length": text_length,
            "text_preview": text[:1024],
        }
