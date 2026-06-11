"""
Unit tests for Phase 2 parser service.
"""

from app.services.parser_service import parser_service


def test_csv_parsing_summary():
    csv_bytes = b"id,name,amount\n1,Acme,100\n2,Widget,200\n"
    summary = parser_service.parse(csv_bytes, "csv")

    assert summary["format"] == "csv"
    assert summary["row_count"] == 2
    assert summary["column_count"] == 3
    assert summary["columns"] == ["id", "name", "amount"]
    assert isinstance(summary["sample"], list)


def test_txt_parsing_summary():
    txt_bytes = b"Hello world\nThis is a test file.\n"
    summary = parser_service.parse(txt_bytes, "txt")

    assert summary["format"] == "txt"
    assert summary["line_count"] == 2
    assert summary["text_length"] == len("Hello world\nThis is a test file.\n")
    assert "Hello world" in summary["text_preview"]
