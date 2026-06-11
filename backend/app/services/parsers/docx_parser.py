"""
DOCX parser implementation for F.R.E.D.A.
"""

from io import BytesIO
from typing import Dict, Any

from docx import Document
from app.services.parsers.base_parser import BaseParser
from app.core.logger import setup_logger

logger = setup_logger(__name__)


class DOCXParser(BaseParser):
    """Parser for DOCX Word documents."""

    def parse(self, file_stream: BytesIO) -> Dict[str, Any]:
        file_stream.seek(0)

        document = Document(file_stream)
        paragraphs = [paragraph.text for paragraph in document.paragraphs if paragraph.text]
        text = "\n".join(paragraphs)
        text_length = len(text)

        logger.info("DOCX file parsed successfully")
        return {
            "format": "docx",
            "paragraph_count": len(paragraphs),
            "text_length": text_length,
            "text_preview": text[:1024],
        }
