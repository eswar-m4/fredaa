from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from app.models.partial_scrape_schemas import (
    PartialScrapeExecutionPlan,
    PartialScrapePlanFeedback,
    PartialScrapePlanResult,
    PartialScrapePlannerMetadata,
)
from app.services.partial_scrape_runtime import execute_partial_scrape, get_partial_scrape_adapter


@dataclass
class _FakeResponse:
    status_code: int
    text: str


def _make_plan_result() -> PartialScrapePlanResult:
    return PartialScrapePlanResult(
        planner_metadata=PartialScrapePlannerMetadata(
            planner_version="partial-scrape-planner-v1",
            planned_at=datetime.utcnow(),
            confidence=0.75,
            model_name="heuristic",
            provider_used="heuristic",
        ),
        feedback=PartialScrapePlanFeedback(
            status="supported",
            execution_summary="Planned partial scrape for Webmd; with filters {'specialty': 'Cardiology', 'state': 'TX', 'accepting_new_patients': 'Yes'}",
            explanation=None,
            clarification_required=[],
            unsupported_reason=None,
        ),
        execution_plan=PartialScrapeExecutionPlan(
            source_name="Webmd",
            source_key="webmd",
            raw_request="Find cardiologists in Texas who are accepting new patients.",
            normalized_request="Planned partial scrape for Webmd; with filters {'specialty': 'Cardiology', 'state': 'TX', 'accepting_new_patients': 'Yes'}",
            execution_strategy="field_filter",
            supported_filters={
                "specialty": "Cardiology",
                "state": "TX",
                "accepting_new_patients": "Yes",
            },
            include_terms=[],
            exclude_terms=[],
            url_hints=[],
            file_types=[],
            crawl_limits={},
            unsupported_constraints=[],
            clarification_required=[],
            adapter_kind="field_filter",
            adapter_payload={
                "filters": {
                    "specialty": "Cardiology",
                    "state": "TX",
                    "accepting_new_patients": "Yes",
                },
                "include_terms": [],
                "exclude_terms": [],
                "url_hints": [],
                "file_types": [],
                "crawl_limits": {},
            },
        ),
    )


def test_partial_scrape_registry_exposes_builtin_adapters():
    assert get_partial_scrape_adapter("webmd") is not None
    assert get_partial_scrape_adapter("keysight") is not None


def test_webmd_partial_scrape_uses_live_pages_and_truncates(monkeypatch):
    from app.services.scrapers import webmd_scraper

    plan_result = _make_plan_result()
    planner_json = plan_result.model_dump_json() if hasattr(plan_result, "model_dump_json") else json.dumps(plan_result.dict(), default=str)

    listing_url = "https://doctor.webmd.com/providers/specialty/cardiovascular-disease/texas"
    profile_urls = [
        "https://doctor.webmd.com/doctor/test-doctor-1-overview",
        "https://doctor.webmd.com/doctor/test-doctor-2-overview",
        "https://doctor.webmd.com/doctor/test-doctor-3-overview",
    ]

    listing_html = """
    <html><body>
      <a href="https://doctor.webmd.com/doctor/test-doctor-1-overview">One</a>
      <a href="https://doctor.webmd.com/doctor/test-doctor-2-overview">Two</a>
      <a href="https://doctor.webmd.com/doctor/test-doctor-3-overview">Three</a>
    </body></html>
    """

    def make_profile_html(name: str, city: str) -> str:
        return f"""
        <html><script>
        window.__INITIAL_STATE__={{"profile":{{"fullname":"{name}","specialtynames":"Cardiovascular Disease","acceptsnewpatients":[true],"locations":[{{"medicalgroup":"{name} Group","city":"{city}","state":"TX","zipcode":"75001","formattedPhone":"(555) 555-5555","Newpatient":true}}]}}}};
        </script></html>
        """

    html_map = {
        listing_url: listing_html,
        profile_urls[0]: make_profile_html("Dr. Alpha", "Dallas"),
        profile_urls[1]: make_profile_html("Dr. Bravo", "Houston"),
        profile_urls[2]: make_profile_html("Dr. Charlie", "Austin"),
    }

    def fake_get(url, headers=None, timeout=None):  # noqa: ANN001
        html = html_map.get(url)
        assert html is not None, f"unexpected url: {url}"
        return _FakeResponse(status_code=200, text=html)

    monkeypatch.setattr(webmd_scraper.requests, "get", fake_get)

    result = execute_partial_scrape(
        source_name="Webmd",
        planner_json=planner_json,
        max_results=2,
    )

    assert len(result.records) == 2
    assert result.execution_metadata["total_matched_records"] == 3
    assert result.execution_metadata["returned_records"] == 2
    assert result.execution_metadata["is_truncated"] is True
    assert listing_url in result.execution_metadata["discovery_urls"]
    assert len(result.execution_metadata["candidate_profile_urls"]) == 3
    assert result.execution_metadata["profiles_scanned"] == 3
    assert all(record["State"] == "TX" for record in result.records)
    assert all(record["Accepting_New_Patients"] == "Yes" for record in result.records)

