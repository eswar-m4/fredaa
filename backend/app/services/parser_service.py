"""
Parser service for F.R.E.D.A

This module routes uploaded files to the appropriate parser based on file format.
"""

from io import BytesIO
from typing import Dict, Any

from app.core.logger import setup_logger
from app.services.parsers import CSVParser, XLSXParser, PDFParser, DOCXParser, TXTParser, JSONParser

logger = setup_logger(__name__)


class ParserService:
    """Service responsible for file parsing orchestration."""

    def __init__(self) -> None:
        self.parsers = {
            "csv": CSVParser(),
            "xlsx": XLSXParser(),
            "xls": XLSXParser(),
            "json": JSONParser(),
            "pdf": PDFParser(),
            "docx": DOCXParser(),
            "txt": TXTParser(),
        }
        logger.info("ParserService initialized with CSV, XLSX/XLS, JSON, PDF, DOCX, TXT parsers")

    def parse(self, file_bytes: bytes, file_format: str) -> Dict[str, Any]:
        """Parse file bytes using the parser for the detected format."""
        parser = self.parsers.get(file_format)
        if parser is None:
            error_msg = f"Unsupported file format for parsing: {file_format}"
            logger.error(error_msg)
            raise ValueError(error_msg)

        logger.info(f"Parsing file with format: {file_format}")
        return parser.parse(BytesIO(file_bytes))


parser_service = ParserService()
