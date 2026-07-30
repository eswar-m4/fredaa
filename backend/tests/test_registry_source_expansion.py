from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.source_trust_service import source_trust_service

client = TestClient(app)


@patch("app.services.registry_scrapers.registry_orchestrator.companies_house_scraper.lookup_company", new_callable=AsyncMock)
def test_companies_house_registry_enrichment_merges_fields(mock_lookup):
    mock_lookup.return_value = {
        "source_type": "government_registry",
        "registry_source": "companies_house",
        "registry_confidence": 0.93,
        "extracted_fields": {
            "company_name": "MICROSOFT LIMITED",
            "company_number": "01624297",
            "registry_number": "01624297",
            "company_status": "Active",
            "incorporation_date": "24 March 1982",
            "registered_office_address": "Microsoft Campus, Thames Valley Park, Reading, Berkshire, RG6 1WG",
            "industry": "62020 - Information technology consultancy activities",
            "sic_description": "62020 - Information technology consultancy activities",
            "officers": [{"name": "Darren Hardman"}],
        },
        "raw_metadata": {"status": "success"},
    }

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "ch-dataset",
                "name": "companies-house.csv",
                "records": [{"company_name": "Microsoft Limited", "country": "UK"}],
            },
            "workflowConfig": {
                "prioritySources": ["Companies House"],
                "requestedOutputFields": [
                    "company_name",
                    "registry_number",
                    "company_status",
                    "incorporation_date",
                    "hq_address",
                    "industry",
                ],
            },
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["registry_enrichment"] is True
    assert summary["workflow_dispatch"]["companies_house_enrichment"] is True
    mock_lookup.assert_awaited_once()

    row = summary["processed_dataset"][0]
    assert row["registry_number"] == "01624297"
    assert row["company_status"] == "Active"
    assert row["incorporation_date"] == "24 March 1982"
    assert "Microsoft Campus" in row["hq_address"]
    assert row["industry"] == "62020 - Information technology consultancy activities"


@patch("app.services.registry_scrapers.registry_orchestrator.gleif_scraper.lookup_company", new_callable=AsyncMock)
def test_gleif_registry_enrichment_uses_lei_and_parent_fields(mock_lookup):
    mock_lookup.return_value = {
        "source_type": "government_registry",
        "registry_source": "gleif",
        "registry_confidence": 0.94,
        "extracted_fields": {
            "company_name": "Acme Holdings Ltd",
            "legal_name": "Acme Holdings Ltd",
            "lei": "549300ACME1234567890",
            "registry_number": "549300ACME1234567890",
            "company_status": "ACTIVE",
            "legal_form": "Private Limited Company",
            "incorporation_date": "2015-04-12",
            "hq_address": "1 Main Street, London, GB",
            "hq_country": "GB",
            "parent_company": "Acme Global Group",
            "parent_lei": "549300PARENT123456789",
            "ultimate_parent_company": "Acme Global Group",
            "ultimate_parent_lei": "549300ULT123456789000",
        },
        "raw_metadata": {"status": "success"},
    }

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "gleif-dataset",
                "name": "gleif.csv",
                "records": [{"company_name": "Acme Holdings Ltd", "lei": "549300ACME1234567890"}],
            },
            "workflowConfig": {
                "prioritySources": ["GLEIF"],
                "requestedOutputFields": [
                    "company_name",
                    "registry_number",
                    "company_status",
                    "incorporation_date",
                    "hq_address",
                    "hq_country",
                    "parent_company",
                    "ultimate_parent_company",
                ],
            },
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["gleif_enrichment"] is True
    mock_lookup.assert_awaited_once()

    row = summary["processed_dataset"][0]
    assert row["registry_number"] == "549300ACME1234567890"
    assert row["company_status"] == "ACTIVE"
    assert row["parent_company"] == "Acme Global Group"
    assert row["ultimate_parent_company"] == "Acme Global Group"


@patch("app.services.registry_scrapers.registry_orchestrator.wikidata_scraper.lookup_company", new_callable=AsyncMock)
def test_wikidata_registry_enrichment_populates_breadth_fields(mock_lookup):
    mock_lookup.return_value = {
        "source_type": "knowledge_graph",
        "registry_source": "wikidata",
        "registry_confidence": 0.67,
        "extracted_fields": {
            "company_name": "Example Corp",
            "legal_name": "Example Corp",
            "description": "Example Corporation is a sample business.",
            "website": "https://example.com",
            "year_founded": 1994,
            "hq_address": "Seattle, Washington, United States",
            "hq_country": "United States",
            "industry": "Software",
            "employee_count": "10000",
            "annual_revenue": "$1.2B",
            "parent_company": "Example Group",
            "subsidiaries": ["Example Labs"],
        },
        "raw_metadata": {"status": "success"},
    }

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "wikidata-dataset",
                "name": "wikidata.csv",
                "records": [{"company_name": "Example Corp"}],
            },
            "workflowConfig": {
                "prioritySources": ["Wikidata"],
                "requestedOutputFields": [
                    "company_name",
                    "year_founded",
                    "annual_revenue",
                    "employee_count",
                    "parent_company",
                    "subsidiaries",
                    "industry",
                ],
            },
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["wikidata_enrichment"] is True
    mock_lookup.assert_awaited_once()

    row = summary["processed_dataset"][0]
    assert row["year_founded"] == 1994
    assert row["annual_revenue"] == "$1.2B"
    assert row["employee_count"] == "10000"
    assert row["parent_company"] == "Example Group"
    assert row["subsidiaries"] == ["Example Labs"]


@patch("app.services.registry_scrapers.registry_orchestrator.wikidata_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.registry_scrapers.registry_orchestrator.companies_house_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.registry_scrapers.registry_orchestrator.gleif_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.registry_scrapers.registry_orchestrator.mca_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.registry_scrapers.registry_orchestrator.sec_scraper.lookup_company", new_callable=AsyncMock)
@patch("app.services.workflow_service.company_verification_service.verify_record", new_callable=AsyncMock)
def test_registry_fan_out_merges_sources_and_reuses_normalized_company_identity(
    mock_verify,
    mock_sec,
    mock_mca,
    mock_gleif,
    mock_companies_house,
    mock_wikidata,
):
    companies = [
        "Apple Inc.",
        "Microsoft Corporation",
        "Infosys Limited",
        "Barclays PLC",
        "JPMorgan Chase & Co.",
    ]

    async def verify_side_effect(record, config):
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

    async def sec_side_effect(company_name, **kwargs):
        if company_name in {"Apple", "Microsoft"}:
            return {
                "source_type": "government_registry",
                "registry_source": "sec_edgar",
                "registry_confidence": 0.95,
                "extracted_fields": {
                    "entity_name": f"{company_name.upper()} INC",
                    "cik": "0000000000",
                    "ticker": "AAPL" if company_name == "Apple" else "MSFT",
                    "filings": [{"filing_type": "10-K", "filing_date": "2025-07-30"}],
                    "profile": {
                        "business_address": f"{company_name} HQ, CA, USA",
                        "mailing_address": f"{company_name} HQ, CA, USA",
                    },
                },
                "raw_metadata": {"status": "success"},
            }
        if company_name == "JPMorgan Chase":
            return {
                "source_type": "government_registry",
                "registry_source": "sec_edgar",
                "registry_confidence": 0.94,
                "extracted_fields": {
                    "entity_name": "JPMORGAN CHASE & CO",
                    "cik": "0000019617",
                    "ticker": "JPM",
                    "profile": {
                        "business_address": "383 Madison Ave, New York, NY, USA",
                        "mailing_address": "383 Madison Ave, New York, NY, USA",
                    },
                },
                "raw_metadata": {"status": "success"},
            }
        return {
            "source_type": "government_registry",
            "registry_source": "sec_edgar",
            "registry_confidence": 0.0,
            "extracted_fields": {},
            "raw_metadata": {"status": "not_found"},
        }

    async def mca_side_effect(company_name, **kwargs):
        if company_name == "Infosys":
            return {
                "source_type": "government_registry",
                "registry_source": "mca_india",
                "registry_confidence": 0.92,
                "extracted_fields": {
                    "company_name": "Infosys Limited",
                    "cin": "L85110KA1981PLC013115",
                    "company_status": "Active",
                    "registered_office_address": "Electronics City, Bengaluru, Karnataka, India",
                },
                "raw_metadata": {"status": "success"},
            }
        return {
            "source_type": "government_registry",
            "registry_source": "mca_india",
            "registry_confidence": 0.0,
            "extracted_fields": {},
            "raw_metadata": {"status": "not_found"},
        }

    async def gleif_side_effect(company_name, **kwargs):
        if company_name in {"Apple", "Microsoft"}:
            return {
                "source_type": "government_registry",
                "registry_source": "gleif",
                "registry_confidence": 0.94,
                "extracted_fields": {
                    "company_name": company_name,
                    "legal_name": company_name,
                    "lei": f"549300{company_name.upper().replace(' ', '')[:10]}",
                    "hq_city": "Cupertino" if company_name == "Apple" else "Redmond",
                    "hq_country": "US",
                },
                "raw_metadata": {"status": "success"},
            }
        return {
            "source_type": "government_registry",
            "registry_source": "gleif",
            "registry_confidence": 0.0,
            "extracted_fields": {},
            "raw_metadata": {"status": "not_found"},
        }

    async def companies_house_side_effect(company_name, **kwargs):
        if company_name == "Barclays PLC":
            return {
                "source_type": "government_registry",
                "registry_source": "companies_house",
                "registry_confidence": 0.91,
                "extracted_fields": {
                    "company_name": "Barclays PLC",
                    "company_number": "1026167",
                    "company_status": "Active",
                    "registered_office_address": "1 Churchill Place, London, E14 5HP",
                    "sic_description": "64191 - Banks",
                },
                "raw_metadata": {"status": "success"},
            }
        return {
            "source_type": "government_registry",
            "registry_source": "companies_house",
            "registry_confidence": 0.0,
            "extracted_fields": {},
            "raw_metadata": {"status": "not_found"},
        }

    async def wikidata_side_effect(company_name, **kwargs):
        base_revenue = {
            "Apple": "$3.0T",
            "Microsoft": "$2.9T",
            "Infosys": "$100B",
            "Barclays PLC": "$50B",
        }.get(company_name, "$1B")
        employee_count = {
            "Apple": "161000",
            "Microsoft": "221000",
            "Infosys": "345000",
            "Barclays PLC": "87000",
        }.get(company_name, "1000")
        return {
            "source_type": "knowledge_graph",
            "registry_source": "wikidata",
            "registry_confidence": 0.67,
            "extracted_fields": {
                "company_name": company_name,
                "legal_name": company_name,
                "description": f"{company_name} company profile",
                "year_founded": 1990,
                "employee_count": employee_count,
                "annual_revenue": base_revenue,
                "parent_company": f"{company_name} Parent",
                "subsidiaries": [f"{company_name} Labs"],
            },
            "raw_metadata": {"status": "success"},
        }

    mock_verify.side_effect = verify_side_effect
    mock_sec.side_effect = sec_side_effect
    mock_mca.side_effect = mca_side_effect
    mock_gleif.side_effect = gleif_side_effect
    mock_companies_house.side_effect = companies_house_side_effect
    mock_wikidata.side_effect = wikidata_side_effect

    response = client.post(
        "/api/v1/workflows/run",
        json={
            "dataset": {
                "id": "registry-fanout-dataset",
                "name": "registry-fanout.csv",
                "records": [{"company_name": company} for company in companies],
            },
            "workflowConfig": {
                "selectedWorkflows": ["Company Verification"],
                "prioritySources": ["SEC", "MCA", "GLEIF", "Companies House", "Wikidata"],
                "requestedOutputFields": [
                    "company_name",
                    "cik",
                    "cin",
                    "company_status",
                    "hq_address",
                    "hq_city",
                    "hq_country",
                    "annual_revenue",
                    "employee_count",
                    "parent_company",
                    "subsidiaries",
                ],
            },
        },
    )

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["workflow_dispatch"]["registry_enrichment"] is True
    assert mock_sec.await_count == len(companies)
    assert mock_mca.await_count == len(companies)
    assert mock_gleif.await_count == len(companies)
    assert mock_companies_house.await_count == len(companies)
    assert mock_wikidata.await_count == len(companies)
    assert {call.args[0] for call in mock_sec.await_args_list} == {"Apple", "Microsoft", "Infosys", "Barclays PLC", "JPMorgan Chase"}
    assert {call.args[0] for call in mock_mca.await_args_list} == {"Apple", "Microsoft", "Infosys", "Barclays PLC", "JPMorgan Chase"}
    assert {call.args[0] for call in mock_gleif.await_args_list} == {"Apple", "Microsoft", "Infosys", "Barclays PLC", "JPMorgan Chase"}
    assert {call.args[0] for call in mock_companies_house.await_args_list} == {"Apple", "Microsoft", "Infosys", "Barclays PLC", "JPMorgan Chase"}
    assert {call.args[0] for call in mock_wikidata.await_args_list} == {"Apple", "Microsoft", "Infosys", "Barclays PLC", "JPMorgan Chase"}

    apple_result = summary["record_results"][0]
    infosys_result = summary["record_results"][2]
    barclays_result = summary["record_results"][3]
    jpmorgan_result = summary["record_results"][4]
    apple = summary["processed_dataset"][0]
    infosys = summary["processed_dataset"][2]
    barclays = summary["processed_dataset"][3]
    jpmorgan = summary["processed_dataset"][4]

    assert apple_result["registry_metadata"]["registry_source"] == "sec_edgar"
    assert apple_result["registry_metadata"]["registry_sources"] == ["sec_edgar", "gleif", "mca_india", "companies_house", "wikidata"]
    assert apple_result["registry_metadata"]["source_results"][0]["source_key"] == "sec_edgar"
    assert apple["hq_city"] == "Cupertino"
    assert apple["annual_revenue"] == "$3.0T"
    assert apple["employee_count"] == "161000"

    assert infosys_result["registry_metadata"]["registry_source"] == "mca_india"
    assert infosys["company_status"] == "Active"
    assert infosys_result["registry_metadata"]["source_results"][2]["source_key"] == "mca_india"

    assert barclays_result["registry_metadata"]["registry_source"] == "companies_house"
    assert barclays["company_status"] == "Active"
    assert "London" in barclays["hq_address"]

    assert jpmorgan_result["registry_metadata"]["registry_source"] == "sec_edgar"
    assert jpmorgan["cik"] == "0000019617"


def test_source_trust_service_classifies_new_registry_domains():
    assert source_trust_service.classify_url("https://api.gleif.org/api/v1/lei-records") == "government_registry"
    assert source_trust_service.classify_url("https://find-and-update.company-information.service.gov.uk/company/01624297") == "government_registry"
    assert source_trust_service.classify_url("https://www.wikidata.org/wiki/Q2283") == "knowledge_graph"
