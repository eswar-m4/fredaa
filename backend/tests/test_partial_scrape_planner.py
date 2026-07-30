from app.api.demo_routes import _extract_partial_scrape_filters
from app.services.partial_scrape_planner_service import partial_scrape_planner_service


def test_partial_scrape_planner_maps_webmd_intent_to_supported_filters():
    result = partial_scrape_planner_service.plan_partial_scrape(
        source_name="Webmd",
        user_request="cardiologists in California accepting new patients",
    )

    assert result.feedback.status == "supported"
    assert result.execution_plan.supported_filters["specialty"] == "Cardiology"
    assert result.execution_plan.supported_filters["state"] == "CA"
    assert result.execution_plan.supported_filters["accepting_new_patients"] == "Yes"
    assert result.planner_metadata.planner_version == "partial-scrape-planner-v1"
    assert result.planner_metadata.model_name == "heuristic"
    assert result.planner_metadata.provider_used == "heuristic"
    assert 0.0 <= result.planner_metadata.confidence <= 1.0


def test_partial_scrape_planner_reports_unsupported_limits_for_keysight():
    result = partial_scrape_planner_service.plan_partial_scrape(
        source_name="Keysight",
        user_request="starting from https://www.keysight.com/us/en/home.html and only the first 10 pages",
    )

    assert result.feedback.status == "supported"
    assert any("crawl" in item.lower() or "starting url" in item.lower() for item in result.execution_plan.unsupported_constraints)


def test_extract_partial_scrape_filters_prefers_planner_json():
    planner_json = """
    {
      "execution_plan": {
        "supported_filters": {
          "specialty": ["Cardiology"],
          "state": ["CA"]
        },
        "adapter_payload": {
          "filters": {
            "specialty": ["Cardiology"],
            "state": ["CA"]
          }
        }
      }
    }
    """

    filters = _extract_partial_scrape_filters(planner_json, "STATE=CA")

    assert filters == {"specialty": ["Cardiology"], "state": ["CA"]}
