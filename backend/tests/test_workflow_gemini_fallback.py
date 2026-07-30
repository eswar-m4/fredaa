"""
Integration test for WorkflowService + Gemini AI Fallback enrichment.
"""

import pytest
from unittest.mock import AsyncMock, patch

from app.services.workflow_service import workflow_service
from app.services.company_verification_service import company_verification_service


@pytest.mark.asyncio
async def test_run_workflow_with_gemini_fallback():
    dataset = {
        "id": "ds-test-bydataset",
        "name": "Test BY Dataset",
        "records": [
            {
                "company_name": "TestCorp",
                "website": "https://www.testcorp.com",
            }
        ],
    }

    config = {
        "selectedWorkflows": ["Website Verification"],
        "selectedWorkflowIds": ["company_data"],
        "requestedOutputFields": ["Legal Name", "Number of Employees"],
        "apiKey": "mock_api_key",
    }

    mock_fallback_data = [
        {
            "entity": "TestCorp",
            "extracted": {
                "Legal Name": "TestCorp Inc.",
                "Number of Employees": "250",
            },
        }
    ]

    with patch.object(
        company_verification_service, "verify_record", new_callable=AsyncMock
    ) as mock_verify, patch(
        "app.services.workflow_service.gemini_fallback_service.extract_fallback_data",
        new_callable=AsyncMock,
    ) as mock_fallback:
        mock_verify.return_value = {
            "company": "TestCorp",
            "discovered_website": "https://www.testcorp.com",
            "scraped_metadata": {"website": "https://www.testcorp.com"},
            "confidence": 90,
            "status": "Auto Approved",
            "record_comparison": {"comparisons": []},
        }

        mock_fallback.return_value = mock_fallback_data

        summary = await workflow_service.run_workflow(dataset, config)

        assert summary is not None
        assert "processed_dataset" in summary
        processed = summary["processed_dataset"]
        assert len(processed) == 1

        rec = processed[0]
        assert rec.get("legal_name") == "TestCorp Inc." or rec.get("Legal Name") == "TestCorp Inc."
        assert rec.get("number_of_employees") == "250" or rec.get("Number of Employees") == "250"
        assert rec.get("_ai_enrichment", {}).get("source") == "ai_fallback"
        assert rec.get("_ai_enrichment", {}).get("confidence") == 50
