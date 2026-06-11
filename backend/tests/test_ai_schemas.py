"""
Unit tests for Phase 3 AI understanding service and endpoints.
"""

import pytest
from app.models.ai_schemas import ProcessedInput, ProcessInputRequest


def test_process_input_request_creation():
    """Test ProcessInputRequest validation."""
    req = ProcessInputRequest(text="Acme Corporation")
    assert req.text == "Acme Corporation"


def test_process_input_request_empty_text():
    """Test that empty text is rejected."""
    with pytest.raises(ValueError):
        ProcessInputRequest(text="")


def test_processed_input_schema():
    """Test ProcessedInput schema creation."""
    processed = ProcessedInput(
        input_type="text",
        entity_type="company",
        raw_input="Acme Corporation",
        content="Acme Corporation",
        normalized_data={"name": "Acme Corporation"},
        summary="Technology company",
        confidence_score=0.95,
        processing_time_ms=450,
    )

    assert processed.input_type == "text"
    assert processed.entity_type == "company"
    assert processed.confidence_score == 0.95
    assert processed.processing_time_ms == 450


def test_processed_input_confidence_bounds():
    """Test that confidence score is bounded 0-1."""
    # Valid: 0.0
    p1 = ProcessedInput(
        input_type="text",
        entity_type="unknown",
        raw_input="test",
        content="test",
        normalized_data={},
        summary="test",
        confidence_score=0.0,
        processing_time_ms=100,
    )
    assert p1.confidence_score == 0.0

    # Valid: 1.0
    p2 = ProcessedInput(
        input_type="text",
        entity_type="unknown",
        raw_input="test",
        content="test",
        normalized_data={},
        summary="test",
        confidence_score=1.0,
        processing_time_ms=100,
    )
    assert p2.confidence_score == 1.0

    # Invalid: > 1.0
    with pytest.raises(ValueError):
        ProcessedInput(
            input_type="text",
            entity_type="unknown",
            raw_input="test",
            content="test",
            normalized_data={},
            summary="test",
            confidence_score=1.5,
            processing_time_ms=100,
        )

    # Invalid: < 0.0
    with pytest.raises(ValueError):
        ProcessedInput(
            input_type="text",
            entity_type="unknown",
            raw_input="test",
            content="test",
            normalized_data={},
            summary="test",
            confidence_score=-0.1,
            processing_time_ms=100,
        )
