from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.database import get_connection
from app.main import app
from app.services.people_contacts_dataset_service import people_contacts_dataset_service


client = TestClient(app)


def _cleanup_job(job_id: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
        conn.execute("DELETE FROM admin_request_audit WHERE job_id = ?", (job_id,))
        conn.commit()
    run_file = Path("backend") / "datasets" / f"{job_id}_run_1.json"
    if run_file.exists():
        run_file.unlink()


def test_people_contacts_dataset_service_uses_llm_when_available():
    job_id = f"J-PC-{uuid4().hex[:10].upper()}"
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO scraper_jobs (id, source, scope, filters, custom_criteria, frequency, delivery,
                                         output_format, dataset_path, status, created_at, is_custom_source, mode, records, fresh)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                job_id,
                "People & Contacts",
                "By Dataset",
                "{}",
                "",
                "Weekly",
                "S3 bucket",
                "JSON",
                "datasets/people_contacts_sample.csv",
                "Running",
                "2026-07-02T00:00:00Z",
                0,
                "By Dataset",
                0,
                100,
            ),
        )
        conn.commit()

    with patch(
        "app.services.people_contacts_dataset_service.enrichment_service.enrich",
        return_value={
            "source_url": "https://acme.com",
            "description": "Acme makes widgets",
            "possible_email": "info@acme.com",
            "possible_phone": "+1 555-1212",
            "social_profiles": ["https://www.linkedin.com/company/acme"],
        },
    ), patch(
        "app.services.people_contacts_dataset_service.fetch_website_metadata",
        new_callable=AsyncMock,
    ) as mock_fetch, patch.object(
        people_contacts_dataset_service,
        "_ollama_chat",
        return_value={
            "parsed": {
                "contacts": [
                    {
                        "full_name": "Jane Park",
                        "first_name": "Jane",
                        "last_name": "Park",
                        "title": "VP Engineering",
                        "seniority": "VP",
                        "department": "Engineering",
                        "email": "jane@acme.com",
                        "linkedin_url": "https://www.linkedin.com/in/janepark",
                        "company_name": "Acme Inc",
                        "company_domain": "acme.com",
                        "confidence": 0.93,
                    }
                ],
                "notes": "llm-extracted",
            }
        },
    ):
        mock_fetch.return_value = {
            "url": "https://acme.com/team",
            "title": "Acme Team",
            "meta_description": "Leadership team",
            "emails": ["info@acme.com"],
            "phone_numbers": ["+1 555-1212"],
            "social_links": ["https://www.linkedin.com/company/acme"],
            "page_text": "Jane Park - VP Engineering",
        }

        result = asyncio.run(
            people_contacts_dataset_service.run_and_finalize(
                job_id=job_id,
                source="People & Contacts",
                input_rows=[{"company_name": "Acme Inc", "domain": "acme.com"}],
                selected_outputs=["full_name", "title", "email", "linkedin_url", "company_name", "company_domain"],
                mapping={},
                picked_sources=["LinkedIn", "Company Website (Team pages)"],
                frequency="Weekly",
                delivery="S3 bucket",
                output_format="JSON",
                dataset_name="People & Contacts",
            )
        )

    assert result["records"]
    first = result["records"][0]
    assert first["full_name"] == "Jane Park"
    assert first["title"] == "VP Engineering"
    assert first["email"] == "jane@acme.com"
    assert first["provider_used"] == "ollama-qwen"

    with get_connection() as conn:
        row = conn.execute(
            "SELECT status, records, next_refresh FROM scraper_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()

    assert row is not None
    assert row[0] == "Review Pending"
    assert row[1] == len(result["records"])
    assert row[2] is not None

    _cleanup_job(job_id)


def test_people_contacts_dataset_service_falls_back_without_llm():
    job_id = f"J-PC-{uuid4().hex[:10].upper()}"
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO scraper_jobs (id, source, scope, filters, custom_criteria, frequency, delivery,
                                         output_format, dataset_path, status, created_at, is_custom_source, mode, records, fresh)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                job_id,
                "People & Contacts",
                "By Dataset",
                "{}",
                "",
                "Weekly",
                "S3 bucket",
                "JSON",
                "datasets/people_contacts_sample.csv",
                "Running",
                "2026-07-02T00:00:00Z",
                0,
                "By Dataset",
                0,
                100,
            ),
        )
        conn.commit()

    with patch(
        "app.services.people_contacts_dataset_service.enrichment_service.enrich",
        return_value={
            "source_url": "https://acme.com",
            "description": "Acme makes widgets",
            "possible_email": "info@acme.com",
            "possible_phone": "+1 555-1212",
            "social_profiles": ["https://www.linkedin.com/company/acme"],
        },
    ), patch(
        "app.services.people_contacts_dataset_service.fetch_website_metadata",
        new_callable=AsyncMock,
    ) as mock_fetch, patch.object(
        people_contacts_dataset_service,
        "_ollama_chat",
        side_effect=ConnectionError("offline"),
    ):
        mock_fetch.return_value = {
            "url": "https://acme.com/team",
            "title": "Acme Team",
            "meta_description": "Leadership team",
            "emails": ["info@acme.com"],
            "phone_numbers": ["+1 555-1212"],
            "social_links": ["https://www.linkedin.com/company/acme"],
            "page_text": "Jane Park - VP Engineering",
        }

        result = asyncio.run(
            people_contacts_dataset_service.run_and_finalize(
                job_id=job_id,
                source="People & Contacts",
                input_rows=[{"company_name": "Acme Inc", "domain": "acme.com"}],
                selected_outputs=["full_name", "title", "email", "linkedin_url", "company_name", "company_domain"],
                mapping={},
                picked_sources=["LinkedIn", "Company Website (Team pages)"],
                frequency="Weekly",
                delivery="S3 bucket",
                output_format="JSON",
                dataset_name="People & Contacts",
            )
        )

    assert result["records"]
    first = result["records"][0]
    assert first["provider_used"] == "scraper+ollama"
    assert first["company_name"] == "Acme Inc"
    assert result["execution_metadata"]["provider_used"] == "heuristic"

    _cleanup_job(job_id)


def test_people_contacts_launch_sets_dataset_identity_and_routes_to_contacts_branch():
    job_id = f"J-PC-{uuid4().hex[:10].upper()}"
    payload = {
        "jobs": [
            {
                "id": job_id,
                "source": "People & Contacts",
                "scope": "By Dataset",
                "filters": json.dumps(
                    {
                        "datasetId": "ds-contacts",
                        "workflowId": "wf-contact-enrichment",
                        "selectedOutputs": ["full_name", "email"],
                        "pickedSources": ["LinkedIn", "Company Website (Team pages)"],
                    }
                ),
                "frequency": "Weekly",
                "delivery": "S3 bucket",
                "output_format": "JSON",
                "isCustomSource": False,
                "mode": "By Dataset",
                "dataset_name": "People & Contacts",
                "seed_file": "test1-copy.csv",
                "input_data": [{"company_name": "Acme Inc", "domain": "acme.com"}],
            }
        ]
    }

    with patch("app.api.demo_routes.asyncio.sleep", new_callable=AsyncMock, return_value=None), patch(
        "app.services.openai_cde_service.openai_cde_service.extract_dataset_data",
        new_callable=AsyncMock,
        return_value=[{"entity": "Acme Inc", "extracted": {}}],
    ):
        response = client.post("/api/v1/demo/jobs/launch", json=payload)

    assert response.status_code == 200
    assert response.json()["launched_count"] == 1

    with get_connection() as conn:
        row = conn.execute(
            "SELECT filters, status FROM scraper_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()

    assert row is not None
    stored_filters = json.loads(row[0])
    assert stored_filters["datasetId"] == "ds-contacts"
    assert stored_filters["workflowId"] == "wf-contact-enrichment"
    assert row[1] in {"Pending Onboarding", "Review Pending", "Running"}

    _cleanup_job(job_id)


def test_people_contacts_service_keeps_one_output_per_input_row():
    job_id = f"J-PC-{uuid4().hex[:10].upper()}"
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO scraper_jobs (id, source, scope, filters, custom_criteria, frequency, delivery,
                                         output_format, dataset_path, status, created_at, is_custom_source, mode, records, fresh)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                job_id,
                "People & Contacts",
                "By Dataset",
                "{}",
                "",
                "Weekly",
                "S3 bucket",
                "JSON",
                "datasets/people_contacts_sample.csv",
                "Running",
                "2026-07-02T00:00:00Z",
                0,
                "By Dataset",
                0,
                100,
            ),
        )
        conn.commit()

    with patch(
        "app.services.people_contacts_dataset_service.enrichment_service.enrich",
        return_value={
            "source_url": "https://example.com",
            "description": "Example company with 201-500 employees",
            "possible_email": "info@example.com",
            "possible_phone": "+1 555-0101",
            "social_profiles": ["https://www.linkedin.com/company/example"],
            "address": "123 Example St, Austin, TX",
        },
    ), patch(
        "app.services.people_contacts_dataset_service.fetch_website_metadata",
        new_callable=AsyncMock,
    ) as mock_fetch, patch.object(
        people_contacts_dataset_service,
        "_ollama_chat",
        return_value={
            "parsed": {
                "contacts": [
                    {
                        "full_name": "Alice Example",
                        "title": "VP Sales",
                        "company_name": "Example Corp",
                        "company_domain": "example.com",
                        "confidence": 0.9,
                    },
                    {
                        "full_name": "Bob Example",
                        "title": "Director Marketing",
                        "company_name": "Example Corp",
                        "company_domain": "example.com",
                        "confidence": 0.7,
                    },
                ]
            }
        },
    ):
        mock_fetch.return_value = {
            "url": "https://example.com/team",
            "title": "Example Team",
            "meta_description": "Team page",
            "emails": ["info@example.com"],
            "phone_numbers": ["+1 555-0101"],
            "social_links": ["https://www.linkedin.com/company/example"],
            "page_text": "Alice Example - VP Sales",
        }

        result = asyncio.run(
            people_contacts_dataset_service.run_and_finalize(
                job_id=job_id,
                source="People & Contacts",
                input_rows=[
                    {"company_name": "Tesco PLC", "domain": "tesco.com"},
                    {"company_name": "Infosys Limited", "domain": "infosys.com"},
                ],
                selected_outputs=["full_name", "title", "company_name", "company_domain", "city", "state", "company_size"],
                mapping={},
                picked_sources=["LinkedIn", "Company Website (Team pages)"],
                frequency="Weekly",
                delivery="S3 bucket",
                output_format="JSON",
                dataset_name="People & Contacts",
            )
        )

    assert len(result["records"]) == 2
    assert {row["company_name"] for row in result["records"]} == {"Tesco PLC", "Infosys Limited"}
    assert all(row["full_name"] == "Alice Example" for row in result["records"])
    assert {row["city"] for row in result["records"]} == {"Austin"}
    assert {row["state"] for row in result["records"]} == {"TX"}
    assert {row["company_size"] for row in result["records"]} == {"201-500 employees"}

    _cleanup_job(job_id)
