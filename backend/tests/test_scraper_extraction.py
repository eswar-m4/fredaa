"""Tests for refined website metadata extraction."""

from app.services.scrapers.website_scraper import (
    _extract_metadata,
    _extract_phone_numbers,
    _is_valid_phone,
    normalize_company_name,
)
from bs4 import BeautifulSoup


def test_phone_rejects_tracking_ids():
    assert not _is_valid_phone("101548410026")
    assert not _is_valid_phone("000012010201")
    assert _is_valid_phone("+1 800-555-1212")
    assert _is_valid_phone("(415) 555-1212")


def test_phone_extraction_from_html():
    html = """
    <html><body>
      <p>Call us at (415) 555-1212 or +1 800-555-1212</p>
      <span>101548410026</span>
      <a href="tel:+442079460958">UK</a>
    </body></html>
    """
    soup = BeautifulSoup(html, "html.parser")
    phones = _extract_phone_numbers(soup, soup.get_text())
    joined = " ".join(phones)
    assert "(415) 555-1212" in joined or "415" in joined
    assert "101548410026" not in joined


def test_company_name_openai_priority():
    html = """
    <html><head>
      <title>Get started with ChatGPT | OpenAI</title>
      <meta property="og:site_name" content="OpenAI" />
      <script type="application/ld+json">
      {"@type":"Organization","name":"OpenAI"}
      </script>
    </head><body>
      <h1>Get started with ChatGPT</h1>
      <footer>© 2026 OpenAI</footer>
    </body></html>
    """
    meta = _extract_metadata(html, "https://openai.com")
    assert meta["detected_company_name"] == "OpenAI"
    assert len(meta["page_text"]) <= 2000
    assert meta["page_text_length"] <= 2000


def test_normalize_company_name():
    assert normalize_company_name("OpenAI, Inc.") == "openai"


def test_error_page_skips_bad_extraction():
    html = """
    <html><head><title>Access Denied</title></head>
    <body>101548410026 1779776941 call</body></html>
    """
    meta = _extract_metadata(html, "https://www.tesla.com")
    assert meta["detected_company_name"] == ""
    assert meta["phone_numbers"] == []
