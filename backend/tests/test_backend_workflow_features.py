"""
Integration tests for batch workflow, persistent review queue, audit trail,
confidence explainability, and ambiguous domain handling.
"""

import io
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.enrichment_service import enrichment_service
from app.services.review_service import review_service
from app.services.website_candidate_scoring_service import website_candidate_scoring_service
from app.services.workflow_service import workflow_service

client = TestClient(app)

OPENAI_METADATA = {
    "url": "https://openai.com",
    "title": "OpenAI",
    "meta_description": "OpenAI researches AI",
    "detected_company_name": "OpenAI",
    "page_text": "OpenAI is an AI research company",
    "emails": ["contact@openai.com"],
    "phone_numbers": [],
    "social_links": ["https://linkedin.com/company/openai"],
    "detected_keywords": ["openai", "research"],
}


@pytest.fixture(autouse=True)
def clear_persistent_stores():
    review_service.clear()
    yield
    review_service.clear()


def test_decide_selection_ambiguous_close_scores():
    scored = [
        {"url": "https://abc-tech.com", "domain": "abc-tech.com", "confidence": 84},
        {"url": "https://abctech.ai", "domain": "abctech.ai", "confidence": 82},
    ]
    decision = website_candidate_scoring_service.decide_selection(
        scored,
        auto_approve_threshold=75,
        min_gap=15,
        ambiguity_score_gap=5,
        review_threshold=60,
    )
    assert decision["ambiguous"] is True
    assert decision["auto_select"] is False


def test_contact_extraction_rejects_asset_email_and_random_digits():
    html = """
    <html><body>
      <img src="/assets/customer-agent-en@2x.png">
      <script>const build = 4705882353;</script>
      <a href="https://www.linkedin.com/company/hubspot">LinkedIn</a>
      <a href="/contact-sales">Contact sales</a>
    </body></html>
    """
    metadata = enrichment_service._extract_metadata(html, "https://www.hubspot.com")
    assert metadata["possible_email"] is None
    assert metadata["possible_phone"] is None
    assert metadata["linkedin_url"] == "https://www.linkedin.com/company/hubspot"
    assert metadata["contact_page_url"] == "https://www.hubspot.com/contact-sales"


@pytest.mark.parametrize(
    ("company", "expected"),
    [
        ("OpenAI", "openai.com"),
        ("Microsoft", "microsoft.com"),
        ("Shopify", "shopify.com"),
        ("Shopfy", "shopify.com"),
        ("Slack Technologies", "slack.com"),
        ("Airbnb Homes", "airbnb.com"),
        ("Databricks Leading Data And AI Platform For Enterprises", "databricks.com"),
        ("Snowflake", "snowflake.com"),
        ("SpaceX", "spacex.com"),
    ],
)
def test_official_root_domain_preferred(company, expected):
    noisy_candidates = [
        {"url": f"https://www.{expected}", "domain": expected, "title": company, "snippet": "Official website"},
        {"url": "https://www.shopifyacademy.com", "domain": "shopifyacademy.com", "title": "Shopify Academy", "snippet": "training"},
        {"url": "https://www.slacktechnologies.com", "domain": "slacktechnologies.com", "title": "Slack Technologies", "snippet": "keyword match"},
        {"url": "https://www.airbnbhomes.com", "domain": "airbnbhomes.com", "title": "Airbnb Homes", "snippet": "rentals"},
        {
            "url": "https://www.databricksleadingdataandaiplatformforenterprises.com",
            "domain": "databricksleadingdataandaiplatformforenterprises.com",
            "title": "Databricks Leading Data And AI Platform For Enterprises",
            "snippet": "keyword stuffed",
        },
    ]
    scored = website_candidate_scoring_service.score_candidates(company, {"company": company}, noisy_candidates)
    assert scored[0]["domain"] == expected


def test_confidence_reasons_on_verify_record():
    with patch(
        "app.services.company_verification_service.fetch_website_metadata",
        new_callable=AsyncMock,
    ) as mock_fetch:
        mock_fetch.return_value = OPENAI_METADATA
        response = client.post(
            "/api/v1/workflows/verify-record",
            json={
                "record": {"company": "OpenAI", "website": "openai.com"},
                "config": {"autoApproveThreshold": 75, "reviewThreshold": 60},
            },
        )
    assert response.status_code == 200
    data = response.json()["result"]
    assert isinstance(data.get("confidence_reasons"), list)
    assert len(data["confidence_reasons"]) >= 1
    assert "trust" in data


@patch("app.services.workflow_service.enrichment_service.enrich")
@patch("app.services.workflow_service.website_discovery_service.discover", new_callable=AsyncMock)
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_contact_enrichment_dispatch_populates_contact_fields(mock_verify, mock_discover, mock_enrich):
    mock_discover.return_value = []
    mock_enrich.return_value = {
        "source_url": "https://example.com",
        "website": "https://example.com",
        "possible_email": "sales@example.com",
        "possible_phone": "+1 800-555-1212",
        "linkedin_url": "https://www.linkedin.com/company/example",
        "twitter_url": "https://x.com/example",
    }
    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "contact-dataset",
                "name": "contacts.csv",
                "records": [{"company_name": "Example", "website": "https://example.com"}],
            },
            "workflowConfig": {
                "selectedWorkflows": ["Contact Enrichment"],
                "requestedOutputFields": ["company_name", "website", "email", "phone_number", "linkedin_url", "twitter_url"],
            },
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["contact_enrichment"] is True
    assert summary["workflow_dispatch"]["website_verification"] is False
    assert mock_verify.await_count == 0
    assert mock_enrich.call_count == 1
    assert summary["auto_approved_records"][0]["discovered_website"] == ""
    assert summary["auto_approved_records"][0]["agents_involved"] == ["Contact Enrichment"]
    assert summary["auto_approved_records"][0]["email"] == "sales@example.com"
    assert summary["auto_approved_records"][0]["phone_number"] == "+1 800-555-1212"
    assert summary["processed_dataset"][0]["email"] == "sales@example.com"
    assert summary["processed_dataset"][0]["phone_number"] == "+1 800-555-1212"
    assert summary["processed_dataset"][0]["linkedin_url"] == "https://www.linkedin.com/company/example"
    assert summary["processed_dataset"][0]["twitter_url"] == "https://x.com/example"
    comparisons = summary["auto_approved_records"][0]["record_comparison"]["comparisons"]
    assert any(item["field"] == "email" and item["suggested_value"] == "sales@example.com" for item in comparisons)
    assert any(item["field"] == "phone_number" and item["suggested_value"] == "+1 800-555-1212" for item in comparisons)
    assert any(item["field"] == "linkedin_url" and item["suggested_value"] == "https://www.linkedin.com/company/example" for item in comparisons)


@patch("app.services.workflow_service.enrichment_service.enrich")
@patch("app.services.workflow_service.website_discovery_service.discover", new_callable=AsyncMock)
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_contact_enrichment_company_website_source_discovers_url_without_website_verification(mock_verify, mock_discover, mock_enrich):
    mock_discover.return_value = [
        {
            "url": "https://www.openai.com",
            "domain": "openai.com",
            "source": "duckduckgo_api",
        }
    ]
    mock_enrich.return_value = {
        "source_url": "https://www.openai.com",
        "linkedin_url": "https://www.linkedin.com/company/openai",
        "twitter_url": "https://x.com/openai",
    }

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "contact-discovery-dataset",
                "name": "contact-discovery.csv",
                "records": [{"company_name": "OpenAI"}],
            },
            "workflowConfig": {
                "selectedWorkflows": ["Contact Enrichment"],
                "prioritySources": ["Company Website"],
                "requestedOutputFields": ["company_name", "email", "phone_number", "linkedin_url", "twitter_url"],
            },
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["website_verification"] is False
    assert summary["workflow_dispatch"]["contact_enrichment"] is True
    assert mock_verify.await_count == 0
    assert mock_discover.await_count == 1
    assert mock_discover.await_args.args[0] == "OpenAI"
    assert mock_enrich.call_args.args[0][0]["url"] == "https://www.openai.com"
    result = summary["record_results"][0]
    assert result["discovered_website"] == ""
    assert result["contact_source"]["source_url"] == "https://www.openai.com"
    assert result["contact_enrichment"]["linkedin_url"] == "https://www.linkedin.com/company/openai"
    row = summary["processed_dataset"][0]
    assert row["linkedin_url"] == "https://www.linkedin.com/company/openai"
    assert row["twitter_url"] == "https://x.com/openai"


@patch("app.services.registry_scrapers.registry_orchestrator.sec_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.workflow_service.enrichment_service.enrich")
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_website_verification_only_runs_website_pipeline(mock_verify, mock_enrich, mock_sec):
    mock_verify.return_value = {
        "company": "Example",
        "website": "https://example.com",
        "discovered_website": "https://example.com",
        "confidence": 96,
        "confidence_reasons": ["official website verified"],
        "status": "Auto Approved",
        "original_data": {"company_name": "Example"},
        "scraped_metadata": {},
        "record_comparison": {"comparisons": [], "conflicts": [], "missing_fields": [], "has_changes": False},
        "matches": [],
    }
    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "website-only-dataset",
                "name": "website-only.csv",
                "records": [{"company_name": "Example"}],
            },
            "workflowConfig": {"selectedWorkflows": ["Website Verification"]},
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["website_verification"] is True
    assert summary["workflow_dispatch"]["contact_enrichment"] is False
    assert summary["workflow_dispatch"]["registry_enrichment"] is False
    assert mock_verify.await_count == 1
    assert mock_enrich.call_count == 0
    assert mock_sec.await_count == 0


@patch("app.services.workflow_service.enrichment_service.enrich")
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_website_verification_then_contact_enrichment_uses_verified_website(mock_verify, mock_enrich):
    mock_verify.return_value = {
        "company": "Example",
        "website": "https://example.com",
        "discovered_website": "https://example.com",
        "confidence": 94,
        "confidence_reasons": ["official website verified"],
        "status": "Auto Approved",
        "original_data": {"company_name": "Example"},
        "scraped_metadata": {},
        "record_comparison": {"comparisons": [], "conflicts": [], "missing_fields": [], "has_changes": False},
        "matches": [],
    }
    mock_enrich.return_value = {
        "source_url": "https://example.com",
        "possible_email": "hello@example.com",
        "possible_phone": "+1 212-555-0100",
    }

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "website-contact-dataset",
                "name": "website-contact.csv",
                "records": [{"company_name": "Example"}],
            },
            "workflowConfig": {
                "selectedWorkflows": ["Website Verification", "Contact Enrichment"],
                "requestedOutputFields": ["company_name", "website", "email", "phone_number"],
            },
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert mock_verify.await_count == 1
    assert mock_enrich.call_args.args[0][0]["url"] == "https://example.com"
    assert summary["processed_dataset"][0]["website"] == "https://example.com"
    assert summary["processed_dataset"][0]["email"] == "hello@example.com"
    assert summary["processed_dataset"][0]["phone_number"] == "+1 212-555-0100"


@patch("app.services.registry_scrapers.registry_orchestrator.sec_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_sec_enrichment_only_routes_to_sec_without_website_verification(mock_verify, mock_sec):
    mock_sec.return_value = {
        "source_type": "government_registry",
        "registry_source": "sec_edgar",
        "registry_confidence": 0.95,
        "extracted_fields": {
            "entity_name": "MICROSOFT CORP",
            "cik": "0000789019",
            "ticker": "MSFT",
            "sic": "7372",
            "sic_description": "Services-Prepackaged Software",
            "filings": [{"filing_type": "10-K", "filing_date": "2025-07-30"}],
            "profile": {"entity_type": "operating"},
        },
        "raw_metadata": {"status": "success"},
    }

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "sec-only-dataset",
                "name": "sec-only.csv",
                "records": [{"company_name": "Microsoft", "country": "US"}],
            },
            "workflowConfig": {
                "selectedWorkflows": ["SEC Enrichment"],
                "prioritySources": ["SEC"],
                "requestedOutputFields": ["company_name", "cik", "ticker", "industry", "filing_type", "filing_date", "sec_company_name", "sec_entity_type"],
            },
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["sec_enrichment"] is True
    assert summary["workflow_dispatch"]["website_verification"] is False
    assert mock_verify.await_count == 0
    assert mock_sec.await_count == 1
    row = summary["processed_dataset"][0]
    assert row["cik"] == "0000789019"
    assert row["ticker"] == "MSFT"
    assert row["industry"] == "Services-Prepackaged Software"
    assert row["filing_type"] == "10-K"
    assert row["filing_date"] == "2025-07-30"
    assert row["sec_company_name"] == "MICROSOFT CORP"
    assert row["sec_entity_type"] == "operating"
    comparisons = summary["auto_approved_records"][0]["record_comparison"]["comparisons"]
    assert any(item["field"] == "ticker" and item["source_label"] == "SEC EDGAR" for item in comparisons)


@patch("app.services.registry_scrapers.registry_orchestrator.sec_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_website_verification_and_sec_enrichment_compose(mock_verify, mock_sec):
    mock_verify.return_value = {
        "company": "Tesla",
        "website": "https://www.tesla.com",
        "discovered_website": "https://www.tesla.com",
        "confidence": 95,
        "confidence_reasons": ["official website verified"],
        "status": "Auto Approved",
        "original_data": {"company_name": "Tesla"},
        "scraped_metadata": {},
        "record_comparison": {"comparisons": [], "conflicts": [], "missing_fields": [], "has_changes": False},
        "matches": [],
    }
    mock_sec.return_value = {
        "source_type": "government_registry",
        "registry_source": "sec_edgar",
        "registry_confidence": 0.93,
        "extracted_fields": {
            "entity_name": "Tesla, Inc.",
            "cik": "0001318605",
            "ticker": "TSLA",
            "filings": [{"filing_type": "10-K", "filing_date": "2025-01-30"}],
        },
        "raw_metadata": {"status": "success"},
    }

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "website-sec-dataset",
                "name": "website-sec.csv",
                "records": [{"company_name": "Tesla", "country": "US"}],
            },
                "workflowConfig": {
                    "selectedWorkflows": ["Website Verification", "SEC Enrichment"],
                    "prioritySources": ["Company Website", "SEC"],
                    "requestedOutputFields": ["company_name", "website", "cik", "ticker"],
                },
            },
        )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert mock_verify.await_count == 1
    assert mock_sec.await_count == 1
    assert summary["processed_dataset"][0]["website"] == "https://www.tesla.com"
    assert summary["processed_dataset"][0]["cik"] == "0001318605"
    assert summary["processed_dataset"][0]["ticker"] == "TSLA"


@pytest.mark.parametrize(
    "sec_fields, expected_website",
    [
        (
            {
                "entity_name": "TESLA, INC.",
                "cik": "0001318605",
                "ticker": "TSLA",
                "website": "https://www.tesla.com",
            },
            "https://www.tesla.com",
        ),
        (
            {
                "entity_name": "ADOBE INC.",
                "cik": "0000796343",
                "ticker": "ADBE",
            },
            "Nil Value",
        ),
    ],
)
@patch("app.services.registry_scrapers.registry_orchestrator.sec_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_sec_mca_only_website_verification_uses_only_sec_mapped_fields(mock_verify, mock_sec, sec_fields, expected_website):
    cik = sec_fields["cik"]
    sec_url = f"https://www.sec.gov/cgi-bin/browse-edgar?CIK={cik}"
    mock_sec.return_value = {
        "source_type": "government_registry",
        "registry_source": "sec_edgar",
        "registry_confidence": 0.93,
        "extracted_fields": sec_fields,
        "raw_metadata": {"status": "success", "company_browse_url": sec_url},
    }

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": f"sec-only-{cik}",
                "name": "sec-only.csv",
                "records": [{"company_name": sec_fields["entity_name"].split(",")[0].title(), "website": "-"}],
            },
            "workflowConfig": {
                "selectedWorkflows": ["Website Verification"],
                "prioritySources": ["SEC/MCA"],
                "requestedOutputFields": ["company_name", "website"],
            },
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert mock_verify.await_count == 0
    assert mock_sec.await_count == 1
    assert summary["website_pipeline_enabled"] is False

    record = summary["record_results"][0]
    comparisons = record["record_comparison"]["comparisons"]
    assert {item["field"] for item in comparisons} == {"company_name", "website"}

    website_comparison = next(item for item in comparisons if item["field"] == "website")
    assert website_comparison["suggested_value"] == expected_website
    assert website_comparison["source_url"] == sec_url
    assert website_comparison["source_label"] == "SEC EDGAR"

    review_entry = summary["review_entries"][0]
    review_website = next(item for item in review_entry["field_comparisons"] if item["field"] == "website")
    assert review_website["suggested_value"] == expected_website
    assert review_website["source_url"] == sec_url
    assert review_website["source_label"] == "SEC EDGAR"

    queue = summary["review_queue"]["level_2_records"][f"sec-only-{cik}"][0]
    queue_website = next(item for item in queue["field_comparisons"] if item["field"] == "website")
    assert queue_website["suggested_value"] == expected_website
    assert queue_website["source_url"] == sec_url
    assert queue_website["source_label"] == "SEC EDGAR"

    assert set(summary["processed_dataset"][0].keys()) == {"company_name", "website"}
    assert summary["processed_dataset"][0]["website"] == expected_website


@patch("app.services.registry_scrapers.registry_orchestrator.sec_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.registry_scrapers.registry_orchestrator.mca_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_priority_sources_sec_mca_and_linkedin_integrate_to_review_and_export(mock_verify, mock_mca, mock_sec):
    mock_verify.return_value = {
        "company": "Base",
        "website": "",
        "discovered_website": "",
        "confidence": 88,
        "confidence_reasons": ["source selected"],
        "status": "Auto Approved",
        "original_data": {},
        "scraped_metadata": {},
        "record_comparison": {"comparisons": [], "conflicts": [], "missing_fields": [], "has_changes": False},
        "matches": [],
    }

    mock_mca.return_value = {
        "source_type": "government_registry",
        "registry_source": "mca_india",
        "registry_confidence": 0.92,
        "extracted_fields": {"cin": "L85110KA1981PLC013115", "company_status": "Active"},
        "raw_metadata": {"status": "success"},
    }
    mock_sec.return_value = {
        "source_type": "government_registry",
        "registry_source": "sec_edgar",
        "registry_confidence": 0.91,
        "extracted_fields": {"cik": "0000789019", "ticker": "MSFT"},
        "raw_metadata": {"status": "success"},
    }

    linkedin_by_company = {
        "microsoft": "https://www.linkedin.com/company/microsoft",
        "apple": "https://www.linkedin.com/company/apple",
        "openai": "https://www.linkedin.com/company/openai",
        "infosys": "https://www.linkedin.com/company/infosys",
    }

    def fake_linkedin_discovery(company: str):
        key = str(company or "").strip().lower()
        url = linkedin_by_company.get(key, "")
        if not url:
            return {}
        return {
            "linkedin_url": url,
            "query": f"{company} LinkedIn company",
            "backend": "api",
            "metadata": {
                "linkedin_url": url,
                "linkedin_company_name": str(company),
                "linkedin_description": f"{company} profile",
            },
        }

    with patch.object(workflow_service, "_discover_linkedin_search_evidence", side_effect=fake_linkedin_discovery):
        response = client.post(
            "/api/v1/workflows/run",
            json={
                "dataset": {
                    "id": "src-integration-dataset",
                    "name": "source-integration.csv",
                    "records": [
                        {"company_name": "Apple"},
                        {"company_name": "Microsoft"},
                        {"company_name": "OpenAI"},
                        {"company_name": "Infosys"},
                    ],
                },
                "workflowConfig": {
                    "selectedWorkflows": ["Website Verification"],
                    "prioritySources": ["SEC/MCA", "LinkedIn"],
                    "requestedOutputFields": ["company_name", "cik", "ticker", "cin", "company_status", "linkedin_url"],
                },
            },
        )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert mock_verify.await_count == 0
    assert mock_sec.await_count >= 1
    assert mock_mca.await_count >= 1

    rows = summary["record_results"]
    assert len(rows) == 4
    for row in rows:
        assert row.get("linkedin_source", {}).get("source") == "LinkedIn Search Result"
        assert row.get("linkedin_source", {}).get("source_url", "").startswith("https://www.linkedin.com/company/")
        comparisons = row.get("record_comparison", {}).get("comparisons", [])
        assert any(item.get("source_label") == "LinkedIn Search Result" for item in comparisons)
        assert any(item.get("source_label") in {"SEC EDGAR", "MCA Registry"} for item in comparisons)

    exported = summary["processed_dataset"]
    assert any(item.get("cik") == "0000789019" for item in exported)
    assert any(item.get("cin") == "L85110KA1981PLC013115" for item in exported)
    assert all(item.get("linkedin_url") for item in exported)


@patch("app.services.registry_scrapers.registry_orchestrator.sec_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.workflow_service.enrichment_service.enrich")
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_website_contact_and_sec_enrichment_all_compose(mock_verify, mock_enrich, mock_sec):
    mock_verify.return_value = {
        "company": "Microsoft",
        "website": "https://www.microsoft.com",
        "discovered_website": "https://www.microsoft.com",
        "confidence": 97,
        "confidence_reasons": ["official website verified"],
        "status": "Auto Approved",
        "original_data": {"company_name": "Microsoft"},
        "scraped_metadata": {},
        "record_comparison": {"comparisons": [], "conflicts": [], "missing_fields": [], "has_changes": False},
        "matches": [],
    }
    mock_enrich.return_value = {
        "source_url": "https://www.microsoft.com",
        "possible_email": "contact@microsoft.com",
        "linkedin_url": "https://www.linkedin.com/company/microsoft",
    }
    mock_sec.return_value = {
        "source_type": "government_registry",
        "registry_source": "sec_edgar",
        "registry_confidence": 0.94,
        "extracted_fields": {
            "entity_name": "MICROSOFT CORP",
            "cik": "0000789019",
            "ticker": "MSFT",
            "filings": [{"filing_type": "10-K", "filing_date": "2025-07-30"}],
        },
        "raw_metadata": {"status": "success"},
    }

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "all-workflows-dataset",
                "name": "all-workflows.csv",
                "records": [{"company_name": "Microsoft", "country": "US"}],
            },
            "workflowConfig": {
                "selectedWorkflows": ["Website Verification", "Contact Enrichment", "SEC Enrichment"],
                "prioritySources": ["Company Website", "SEC"],
                "requestedOutputFields": ["company_name", "website", "email", "linkedin_url", "cik", "ticker"],
            },
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["website_verification"] is True
    assert summary["workflow_dispatch"]["contact_enrichment"] is True
    assert summary["workflow_dispatch"]["sec_enrichment"] is True
    row = summary["processed_dataset"][0]
    assert row["website"] == "https://www.microsoft.com"
    assert row["email"] == "contact@microsoft.com"
    assert row["linkedin_url"] == "https://www.linkedin.com/company/microsoft"
    assert row["cik"] == "0000789019"
    assert row["ticker"] == "MSFT"


@patch("app.services.workflow_service.enrichment_service.enrich")
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_data_refresh_only_does_not_run_website_or_contact_enrichment(mock_verify, mock_enrich):
    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "refresh-dataset",
                "name": "refresh.csv",
                "records": [{"company_name": "Example", "website": "https://example.com"}],
            },
            "workflowConfig": {"selectedWorkflows": ["Data Refresh"]},
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["data_refresh"] is True
    assert summary["workflow_dispatch"]["website_verification"] is False
    assert summary["workflow_dispatch"]["contact_enrichment"] is False
    assert mock_verify.await_count == 0
    assert mock_enrich.call_count == 0
    assert summary["auto_approved_records"][0]["discovered_website"] == ""
    assert summary["auto_approved_records"][0]["agents_involved"] == ["Data Refresh"]
    assert summary["processed_dataset"][0]["company_name"] == "Example"


@patch("app.services.registry_scrapers.registry_orchestrator.sec_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.registry_scrapers.registry_orchestrator.mca_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_company_verification_routes_mca_and_sec_sources(mock_verify, mock_mca, mock_sec):
    def verify_side_effect(record, config):
        company = record.get("company") or record.get("company_name")
        return {
            "company": company,
            "website": "",
            "discovered_website": "",
            "confidence": 100,
            "confidence_reasons": ["verified"],
            "status": "Auto Approved",
            "original_data": record,
            "scraped_metadata": {},
            "record_comparison": {"comparisons": [], "conflicts": [], "missing_fields": [], "has_changes": False},
            "matches": [],
        }

    mock_verify.side_effect = verify_side_effect
    mock_mca.return_value = {
        "source_type": "government_registry",
        "registry_source": "mca_india",
        "registry_confidence": 0.92,
        "extracted_fields": {
            "company_name": "Infosys",
            "cin": "L85110KA1981PLC013115",
            "company_status": "Active",
            "directors": [{"name": "Nandan Nilekani"}],
        },
        "raw_metadata": {"status": "success"},
    }
    mock_sec.return_value = {
        "source_type": "government_registry",
        "registry_source": "sec_edgar",
        "registry_confidence": 0.94,
        "extracted_fields": {
            "entity_name": "MICROSOFT CORP",
            "cik": "0000789019",
            "ticker": "MSFT",
            "filings": [{"filing_type": "10-K", "filing_date": "2025-07-30"}],
        },
        "raw_metadata": {"status": "success"},
    }

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "registry-dataset",
                "name": "registry.csv",
                "records": [
                    {"company_name": "Infosys"},
                    {"company_name": "Microsoft"},
                ],
            },
            "workflowConfig": {
                "selectedWorkflows": ["Company Verification"],
                "prioritySources": ["MCA", "SEC"],
                "requestedOutputFields": ["company_name", "cin", "company_status", "directors", "cik", "ticker", "filings"],
            },
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["registry_enrichment"] is True
    assert mock_mca.await_count == 1
    assert mock_sec.await_count == 1
    assert mock_mca.await_args.args[0] == "Infosys"
    assert mock_sec.await_args.args[0] == "Microsoft"
    infosys = summary["auto_approved_records"][0]
    microsoft = summary["auto_approved_records"][1]
    assert infosys["registry_metadata"]["registry_source"] == "mca_india"
    assert microsoft["registry_metadata"]["registry_source"] == "sec_edgar"
    assert any(item["field"] == "company_status" and item["suggested_value"] == "Active" for item in infosys["record_comparison"]["comparisons"])
    assert any(item["field"] == "ticker" and item["suggested_value"] == "MSFT" for item in microsoft["record_comparison"]["comparisons"])
    assert summary["processed_dataset"][0]["cin"] == "L85110KA1981PLC013115"
    assert summary["processed_dataset"][0]["company_status"] == "Active"
    assert summary["processed_dataset"][1]["cik"] == "0000789019"
    assert summary["processed_dataset"][1]["ticker"] == "MSFT"


@patch("app.services.company_verification_service.fetch_website_metadata", new_callable=AsyncMock)
def test_batch_process_csv(mock_fetch):
    mock_fetch.return_value = OPENAI_METADATA
    csv_content = "company,website\nOpenAI,openai.com\nFake Test Co,\n"
    files = {"file": ("companies.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}
    with patch(
        "app.services.company_verification_service.website_discovery_service.discover",
        new_callable=AsyncMock,
    ) as mock_discover:
        mock_discover.return_value = [
            {"url": "https://fake-test.net", "domain": "fake-test.net", "title": "Fake", "snippet": "x"},
        ]
        response = client.post(
            "/api/v1/workflows/batch-process",
            files=files,
            data={"autoApproveThreshold": 75, "reviewThreshold": 60, "ambiguityScoreGap": 5},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    summary = body["summary"]
    assert summary["total_records"] == 2
    assert summary["auto_approved"] + summary["needs_review"] + summary["failed"] == 2
    assert "auto_approved_records" in body
    assert "review_records" in body
    assert "failed_records" in body


@patch("app.services.company_verification_service.fetch_website_metadata", new_callable=AsyncMock)
def test_review_decision_apis(mock_fetch):
    mock_fetch.return_value = OPENAI_METADATA
    client.post(
        "/api/v1/workflows/run",
        json={
            "workflowConfig": {"selectedWorkflows": ["Website Verification"], "autoApproveThreshold": 99, "reviewThreshold": 60},
            "dataset": {
                "id": "ds_review_api",
                "name": "Review API Test",
                "records": [{"company": "Weak Co", "website": "unknown-site.xyz"}],
            },
        },
    )

    list_resp = client.get("/api/v1/reviews", params={"dataset_id": "ds_review_api"})
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert len(items) >= 1
    review_id = items[0]["id"]

    get_resp = client.get(f"/api/v1/reviews/{review_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["item"]["review_status"] == "pending"

    approve_resp = client.post(
        f"/api/v1/reviews/{review_id}/approve",
        json={"approved_values": {"website": "https://fixed.example"}},
    )
    assert approve_resp.status_code == 200
    assert approve_resp.json()["item"]["review_status"] == "approved"


@patch("app.services.company_verification_service.fetch_website_metadata", new_callable=AsyncMock)
def test_review_reject_and_edit(mock_fetch):
    mock_fetch.return_value = OPENAI_METADATA
    client.post(
        "/api/v1/workflows/run",
        json={
            "workflowConfig": {"selectedWorkflows": ["Website Verification"], "autoApproveThreshold": 99, "reviewThreshold": 60},
            "dataset": {
                "id": "ds_reject_edit",
                "name": "Reject Edit Test",
                "records": [{"company": "Another Weak", "website": "bad.example"}],
            },
        },
    )
    items = client.get("/api/v1/reviews", params={"dataset_id": "ds_reject_edit"}).json()["items"]
    review_id = items[0]["id"]

    edit_resp = client.post(
        f"/api/v1/reviews/{review_id}/edit",
        json={"corrected_values": {"company": "Corrected Co", "website": "https://corrected.com"}},
    )
    assert edit_resp.status_code == 200
    assert edit_resp.json()["item"]["review_status"] == "edited"

    reject_resp = client.post(
        f"/api/v1/reviews/{review_id}/reject",
        json={"reason": "Not a valid match"},
    )
    assert reject_resp.status_code == 200
    assert reject_resp.json()["item"]["review_status"] == "rejected"


@patch("app.services.company_verification_service.fetch_website_metadata", new_callable=AsyncMock)
def test_audit_trail_endpoint(mock_fetch):
    mock_fetch.return_value = OPENAI_METADATA
    client.post(
        "/api/v1/workflows/run",
        json={
            "workflowConfig": {"selectedWorkflows": ["Website Verification"], "autoApproveThreshold": 75, "reviewThreshold": 60},
            "dataset": {
                "id": "ds_audit",
                "name": "Audit Test",
                "records": [{"company": "OpenAI", "website": "openai.com"}],
            },
        },
    )
    audit_resp = client.get("/api/v1/audit", params={"dataset_id": "ds_audit", "limit": 50})
    assert audit_resp.status_code == 200
    events = audit_resp.json()["events"]
    assert len(events) >= 1
    assert events[0].get("event_type") == "record_processed"


@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_linkedin_only_source_does_not_fallback_to_company_website(mock_verify):
    with patch.object(
        workflow_service,
        "_discover_linkedin_search_evidence",
        return_value={},
    ):
        response = client.post(
            "/api/v1/workflows/run",
            json={
                "dataset": {
                    "id": "linkedin-only-dataset",
                    "name": "linkedin-only.csv",
                    "records": [{"company_name": "Microsoft"}],
                },
                "workflowConfig": {
                    "selectedWorkflows": ["Website Verification"],
                    "prioritySources": ["LinkedIn"],
                },
            },
        )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["website_verification"] is True
    assert mock_verify.await_count == 0
    record = summary["record_results"][0]
    assert record["discovered_website"] == ""
    assert record["linkedin_source"]["source"] == "LinkedIn Search Result"
    assert record["linkedin_source"]["source_url"] == "Not Found"
    assert summary["auto_approved_records"][0]["selected_priority_sources"] == ["LinkedIn"]


@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_linkedin_only_source_creates_linkedin_comparisons_when_discovered(mock_verify):
    linkedin_url = "https://www.linkedin.com/company/microsoft"
    with patch.object(
        workflow_service,
        "_discover_linkedin_search_evidence",
        return_value={
            "linkedin_url": linkedin_url,
            "query": "Microsoft LinkedIn company",
            "backend": "api",
            "metadata": {
                "linkedin_url": linkedin_url,
                "linkedin_company_name": "Microsoft",
                "linkedin_description": "Overview",
            },
        },
    ):
        response = client.post(
            "/api/v1/workflows/run",
            json={
                "dataset": {
                    "id": "linkedin-discovered-dataset",
                    "name": "linkedin-discovered.csv",
                    "records": [{"company_name": "Microsoft"}],
                },
                "workflowConfig": {
                    "selectedWorkflows": ["Website Verification"],
                    "prioritySources": ["LinkedIn"],
                },
            },
        )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert mock_verify.await_count == 0
    record = summary["record_results"][0]
    comparisons = record["record_comparison"]["comparisons"]
    assert any(item["field"] == "linkedin_url" for item in comparisons)
    assert all((item.get("source_label") == "LinkedIn Search Result") for item in comparisons)
    assert record["linkedin_source"]["source_url"] == linkedin_url


@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_linkedin_only_source_uses_search_result_metadata_for_known_companies(mock_verify):
    company_urls = {
        "microsoft": "https://www.linkedin.com/company/microsoft",
        "apple": "https://www.linkedin.com/company/apple",
        "openai": "https://www.linkedin.com/company/openai",
        "infosys": "https://www.linkedin.com/company/infosys",
    }

    def fake_discovery(company: str):
        key = str(company or "").strip().lower()
        url = company_urls.get(key, "")
        if not url:
            return {}
        return {
            "linkedin_url": url,
            "query": f"{company} LinkedIn company",
            "backend": "api",
            "metadata": {
                "linkedin_url": url,
                "linkedin_company_name": company,
                "linkedin_description": f"{company} LinkedIn result preview",
            },
        }

    with patch.object(workflow_service, "_discover_linkedin_search_evidence", side_effect=fake_discovery):
        response = client.post(
            "/api/v1/workflows/run",
            json={
                "dataset": {
                    "id": "linkedin-known-companies",
                    "name": "linkedin-known-companies.csv",
                    "records": [
                        {"company_name": "Microsoft"},
                        {"company_name": "Apple"},
                        {"company_name": "OpenAI"},
                        {"company_name": "Infosys"},
                    ],
                },
                "workflowConfig": {
                    "selectedWorkflows": ["Website Verification"],
                    "prioritySources": ["LinkedIn"],
                },
            },
        )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert mock_verify.await_count == 0
    assert summary["workflow_dispatch"]["website_verification"] is True
    for item in summary["record_results"]:
        company = str(item.get("company") or "").lower()
        assert item.get("discovered_website") == ""
        assert item.get("linkedin_source", {}).get("source") == "LinkedIn Search Result"
        assert item.get("linkedin_source", {}).get("source_url") == company_urls[company]


@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_review_queue_deduplicates_pending_reviews(mock_verify):
    mock_verify.return_value = {
        "company": "DuplicateCo",
        "website": "https://www.duplicateco.com",
        "discovered_website": "https://www.duplicateco.com",
        "confidence": 80,
        "confidence_reasons": ["duplicate test"],
        "status": "Partially Verified",
        "original_data": {"company_name": "DuplicateCo"},
        "scraped_metadata": {},
        "record_comparison": {
            "comparisons": [
                {
                    "field": "website",
                    "existing_value": None,
                    "suggested_value": "https://www.duplicateco.com",
                    "change_detected": True,
                    "status": "missing_in_upload",
                    "source_url": "https://www.duplicateco.com",
                    "source": "Company Website",
                    "source_label": "Company Website",
                    "priority_source": "Company Website",
                    "confidence": 80,
                }
            ],
            "conflicts": [],
            "missing_fields": ["website"],
            "has_changes": True,
            "summary": "Website missing",
        },
        "matches": [],
    }

    payload = {
        "dataset": {
            "id": "duplicate-review-dataset",
            "name": "duplicate-review.csv",
            "records": [{"company_name": "DuplicateCo"}],
        },
        "workflowConfig": {
            "selectedWorkflows": ["Website Verification"],
            "prioritySources": ["Company Website"],
        },
    }

    first = client.post("/api/v1/workflows/run", json=payload)
    second = client.post("/api/v1/workflows/run", json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    queue = review_service.get_review_queue("duplicate-review-dataset")
    assert queue["total_pending"] == 1
    assert len(queue["level_2_records"]["duplicate-review-dataset"]) == 1


def test_malformed_csv_batch_returns_400():
    files = {"file": ("bad.csv", io.BytesIO(b"not,valid\ndata"), "text/csv")}
    response = client.post("/api/v1/workflows/batch-process", files=files)
    assert response.status_code in (200, 400)
