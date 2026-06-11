from unittest.mock import patch

from app.services.enrichment_service import EnrichmentService


def test_enrich_does_not_assign_linkedin_evidence_as_website():
    html_text = (
        '<html><head><title>Microsoft | LinkedIn</title></head>'
        '<body><a href="https://www.microsoft.com">Visit website</a></body></html>'
    )
    service = EnrichmentService()
    with patch.object(service, "_fetch_page_html", return_value=html_text):
        result = service.enrich([{"url": "https://www.linkedin.com/company/microsoft"}], [])

    assert result["source_url"] == "https://www.linkedin.com/company/microsoft"
    assert result["website"] == "https://www.microsoft.com"


def test_enrich_keeps_company_website_source_url_when_page_is_actual_website():
    html_text = '<html><head><title>Acme Corp</title></head><body></body></html>'
    service = EnrichmentService()
    with patch.object(service, "_fetch_page_html", return_value=html_text):
        result = service.enrich([{"url": "https://www.acme.com"}], [])

    assert result["source_url"] == "https://www.acme.com"
    assert result["website"] == "https://www.acme.com"
