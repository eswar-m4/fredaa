import json
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.models.ai_schemas import ProcessedInput
from app.models.schema_inference_schemas import SchemaInferenceResult
from app.services.enrichment_service import enrichment_service
from app.services.freshness_detection_service import freshness_detection_service
from app.services.recommendation_service import recommendation_service

client = TestClient(app)


def make_processed_input(name: str, entity_type: str = "organization") -> ProcessedInput:
    return ProcessedInput(
        input_type="text",
        entity_type=entity_type,
        raw_input=name,
        content=name,
        normalized_data={"name": name} if name else {},
        summary=f"Processed {name}",
        confidence_score=0.92,
        attributes={"name": name} if name else {},
        metadata={"ai_model": "gemini"},
        processing_time_ms=120,
    )


def make_schema_result() -> SchemaInferenceResult:
    return SchemaInferenceResult(
        dataset_type="company_data",
        primary_entity="organization",
        confidence_score=0.88,
        schema=[],
        metadata={"inference_method": "ai_schema_inference", "processing_time_ms": 50},
    )


@patch("app.services.schema_inference_service.schema_inference_service.infer_schema")
@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_process_gateway_organization_matching(mock_understand, mock_infer_schema):
    mock_understand.return_value = make_processed_input("OpenAI", entity_type="organization")
    mock_infer_schema.return_value = make_schema_result()

    response = client.post("/api/v1/process", json={"name": "OpenAI", "domain": "openai.com"})

    assert response.status_code == 200
    data = response.json()
    assert data["request_id"]
    assert data["total_inputs"] == 1
    assert any(item["source_type"] == "linkedin" for item in data["source_candidates"])
    assert len(data["candidate_matches"]) >= 1
    assert data["candidate_matches"][0]["confidence"] <= 1.0


@patch("app.services.schema_inference_service.schema_inference_service.infer_schema")
@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_process_gateway_people_matching(mock_understand, mock_infer_schema):
    mock_understand.return_value = make_processed_input("Jane Doe", entity_type="person")
    mock_infer_schema.return_value = SchemaInferenceResult(
        dataset_type="people_records",
        primary_entity="person",
        confidence_score=0.91,
        schema=[],
        metadata={"inference_method": "ai_schema_inference", "processing_time_ms": 50},
    )

    response = client.post(
        "/api/v1/process",
        data={"text": "Jane Doe is an experienced product manager.", "user_defined_sources": json.dumps(["https://linkedin.com/in/janedoe"])}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["total_inputs"] == 1
    assert any((cand.get("source_type") and "linkedin" in cand.get("source_type")) for cand in data["candidate_matches"])
    assert any("linkedin" in source["query"].lower() for source in data["source_candidates"])


@patch("app.services.schema_inference_service.schema_inference_service.infer_schema")
@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_process_gateway_custom_source_urls(mock_understand, mock_infer_schema):
    mock_understand.return_value = make_processed_input("Acme Supplies", entity_type="organization")
    mock_infer_schema.return_value = make_schema_result()

    response = client.post(
        "/api/v1/process",
        data={
            "text": "Acme Supplies",
            "user_defined_sources": "https://custom-directory.example.com/profile,https://business.gov/lookup"
        }
    )

    assert response.status_code == 200
    data = response.json()
    assert any(src["source_type"] == "company_website" for src in data["source_candidates"])
    assert any(src["source_type"] == "government_registry" for src in data["source_candidates"])


@patch("app.services.schema_inference_service.schema_inference_service.infer_schema")
@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_process_gateway_multiple_entity_candidates(mock_understand, mock_infer_schema):
    mock_understand.return_value = make_processed_input("OpenAI", entity_type="organization")
    mock_infer_schema.return_value = make_schema_result()

    response = client.post("/api/v1/process", json=[{"name": "OpenAI"}, {"name": "OpenAI Labs"}])

    assert response.status_code == 200
    data = response.json()
    assert data["total_inputs"] == 1
    assert len(data["candidate_matches"]) <= 10
    assert data["summary"]["successful_inputs"] == 1


@patch("app.services.schema_inference_service.schema_inference_service.infer_schema")
@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_process_gateway_low_confidence_scenario(mock_understand, mock_infer_schema):
    mock_understand.return_value = ProcessedInput(
        input_type="text",
        entity_type=None,
        raw_input="Unknown record",
        content="Unknown record",
        normalized_data={},
        summary="Unable to confidently resolve entity.",
        confidence_score=0.15,
        attributes={},
        metadata={"ai_model": "gemini"},
        processing_time_ms=120,
    )
    mock_infer_schema.side_effect = ValueError("No structured dataset information available for schema inference.")

    response = client.post("/api/v1/process", json={"department": "Human Resources"})

    assert response.status_code == 200
    data = response.json()
    assert data["candidate_matches"]
    assert data["candidate_matches"][0]["confidence"] <= 0.5


@patch("app.services.recommendation_service.recommendation_service.recommend")
@patch("app.services.freshness_detection_service.freshness_detection_service.analyze")
@patch("app.services.enrichment_service.enrichment_service.enrich")
@patch("app.services.source_retrieval_service.source_retrieval_service.retrieve")
@patch("app.services.candidate_resolution_service.candidate_resolution_service.resolve")
@patch("app.services.source_discovery_service.source_discovery_service.discover")
@patch("app.services.schema_inference_service.schema_inference_service.infer_schema")
@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_process_gateway_review_required_for_low_confidence(
    mock_understand,
    mock_infer_schema,
    mock_discover,
    mock_resolve,
    mock_retrieve,
    mock_enrich,
    mock_freshness,
    mock_recommend,
):
    mock_understand.return_value = make_processed_input("Mobius Consulting", entity_type="organization")
    mock_infer_schema.return_value = make_schema_result()
    mock_discover.return_value = [
        {"source_type": "company_website", "query": "Mobius Consulting", "priority": 1}
    ]
    mock_resolve.return_value = [
        {"candidate_name": "Mobius Consulting", "confidence": 0.78, "reason": "Low confidence entity match.", "source_type": "company_website"}
    ]
    mock_retrieve.return_value = [
        {
            "title": "Mobius Consulting",
            "url": "https://mobiusconsulting.com",
            "snippet": "Official company website",
            "source_type": "company_website",
            "confidence": 0.78,
        }
    ]
    mock_enrich.return_value = {
        "company_name": "Mobius Consulting",
        "website": "https://mobiusconsulting.com",
        "source_url": "https://mobiusconsulting.com",
    }
    mock_freshness.return_value = []
    mock_recommend.return_value = []

    response = client.post("/api/v1/process", json={"name": "Mobius Consulting"})

    assert response.status_code == 200
    data = response.json()
    assert data["review_required"] is True
    assert len(data["review_candidates"]) == 1
    assert data["review_candidates"][0]["url"] == "https://mobiusconsulting.com"


@patch("app.services.recommendation_service.recommendation_service.recommend")
@patch("app.services.freshness_detection_service.freshness_detection_service.analyze")
@patch("app.services.enrichment_service.enrichment_service.enrich")
@patch("app.services.source_retrieval_service.source_retrieval_service.retrieve")
@patch("app.services.schema_inference_service.schema_inference_service.infer_schema")
@patch("app.services.ai_understanding_service.ai_understanding_service.understand_input")
def test_process_gateway_enrichment_pipeline(
    mock_understand,
    mock_infer_schema,
    mock_retrieve,
    mock_enrich,
    mock_freshness,
    mock_recommend,
):
    mock_understand.return_value = make_processed_input("OpenAI", entity_type="organization")
    mock_infer_schema.return_value = make_schema_result()
    mock_retrieve.return_value = [
        {
            "title": "OpenAI - Official Site",
            "url": "https://openai.com",
            "snippet": "Artificial intelligence research company",
            "source_type": "company_website",
            "confidence": 0.96,
        }
    ]
    mock_enrich.return_value = {
        "company_name": "OpenAI",
        "website": "https://openai.com",
        "possible_email": "contact@openai.com",
        "source_url": "https://openai.com",
    }
    mock_freshness.return_value = [
        {
            "field": "email",
            "current_value": "old@company.com",
            "suggested_value": "contact@openai.com",
            "change_detected": True,
            "confidence": 0.94,
        }
    ]
    mock_recommend.return_value = [
        {
            "field": "email",
            "current_value": "old@company.com",
            "recommended_value": "contact@openai.com",
            "confidence": 0.95,
            "source": "https://openai.com",
            "reason": "Official company website contains updated email.",
        }
    ]

    response = client.post(
        "/api/v1/process",
        json={"name": "OpenAI", "website": "https://openai.com"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["live_source_results"][0]["url"] == "https://openai.com"
    assert data["enriched_data"]["possible_email"] == "contact@openai.com"
    assert data["freshness_analysis"][0]["field"] == "email"
    assert data["recommended_changes"][0]["recommended_value"] == "contact@openai.com"


def test_enrichment_service_parses_metadata():
    html_body = """
    <html><head>
    <title>OpenAI | AI Research</title>
    <meta name='description' content='Creating safe AGI for the benefit of humanity.' />
    <meta property='og:site_name' content='OpenAI' />
    </head><body>
    <a href='mailto:contact@openai.com'>Email us</a>
    <a href='https://linkedin.com/company/openai'>LinkedIn</a>
    </body></html>
    """

    result = enrichment_service._extract_metadata(html_body, "https://openai.com")
    assert result["company_name"] == "OpenAI"
    assert result["possible_email"] == "contact@openai.com"
    assert "linkedin.com" in result["social_profiles"][0]


def test_freshness_detection_detects_changes():
    processed_results = [
        {
            "status": "success",
            "result": make_processed_input("OpenAI"),
        }
    ]
    enriched_data = {
        "company_name": "OpenAI",
        "possible_email": "contact@openai.com",
        "website": "https://openai.com",
    }

    analysis = freshness_detection_service.analyze(processed_results, enriched_data)
    assert any(item["field"] == "email" and item["change_detected"] for item in analysis)


def test_recommendation_service_builds_suggestions():
    freshness_analysis = [
        {
            "field": "email",
            "current_value": "old@company.com",
            "suggested_value": "contact@openai.com",
            "change_detected": True,
            "confidence": 0.94,
        }
    ]
    enriched_data = {"source_url": "https://openai.com", "company_name": "OpenAI"}
    recommendations = recommendation_service.recommend(freshness_analysis, enriched_data)
    assert recommendations[0]["field"] == "email"
    assert recommendations[0]["recommended_value"] == "contact@openai.com"
    assert recommendations[0]["source"] == "https://openai.com"
