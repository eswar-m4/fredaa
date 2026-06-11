"""
TXT parser implementation for F.R.E.D.A.
"""

from io import BytesIO
from typing import Dict, Any

from app.services.parsers.base_parser import BaseParser
from app.core.logger import setup_logger

logger = setup_logger(__name__)


class TXTParser(BaseParser):
    """Parser for plain text files."""

    def parse(self, file_stream: BytesIO) -> Dict[str, Any]:
        file_stream.seek(0)
        raw_bytes = file_stream.read()

        try:
            text = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            text = raw_bytes.decode("latin-1", errors="replace")

        text_length = len(text)
        line_count = len(text.splitlines())

        logger.info("TXT file parsed successfully")
        return {
            "format": "txt",
            "line_count": line_count,
            "text_length": text_length,
            "text_preview": text[:1024],
        }
