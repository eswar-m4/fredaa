"""
Parser package for F.R.E.D.A file parsing engine.
"""

from app.services.parsers.csv_parser import CSVParser
from app.services.parsers.xlsx_parser import XLSXParser
from app.services.parsers.pdf_parser import PDFParser
from app.services.parsers.docx_parser import DOCXParser
from app.services.parsers.txt_parser import TXTParser
from app.services.parsers.json_parser import JSONParser

__all__ = [
    "CSVParser",
    "XLSXParser",
    "PDFParser",
    "DOCXParser",
    "TXTParser",
    "JSONParser",
]
