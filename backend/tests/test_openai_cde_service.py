from __future__ import annotations

import json

import pytest

from app.services.openai_cde_service import merge_openai_cde_values, openai_cde_service


def test_merge_openai_cde_values_only_fills_missing_fields():
    record = {
        "legal_name": "Acme Ltd",
        "website": "",
        "employees": None,
    }
    extracted = {
        "legal_name": "Wrong Value",
        "website": "https://acme.example",
        "employees": "120",
    }

    merged = merge_openai_cde_values(record, extracted, requested_fields=["legal_name", "website", "employees"])

    assert merged["legal_name"] == "Acme Ltd"
    assert merged["website"] == "https://acme.example"
    assert merged["employees"] == "120"
    assert merged["_ai_enrichment"]["source"] == "openai_cde"
    assert "website" in merged["_ai_enrichment"]["filled_fields"]
    assert "legal_name" not in merged["_ai_enrichment"]["filled_fields"]


@pytest.mark.asyncio
async def test_extract_dataset_data_parses_openai_response(monkeypatch):
    monkeypatch.setattr("app.services.openai_cde_service.settings.OPENAI_API_KEY", "test-key")
    monkeypatch.setattr("app.services.openai_cde_service.settings.OPENAI_MODEL", "gpt-4o-mini")

    captured = {}

    class FakeResponse:
        def __init__(self, payload: dict[str, object], status_code: int = 200):
            self._payload = payload
            self.status_code = status_code
            self.text = json.dumps(payload)

        @property
        def is_success(self) -> bool:
            return 200 <= self.status_code < 300

        def json(self) -> dict[str, object]:
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            captured["timeout"] = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers=None, json=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["body"] = json
            response_payload = {
                "output_text": json_module.dumps(
                    {
                        "records": [
                            {
                                "record_index": 0,
                                "entity": "Acme Ltd",
                                "extracted": {
                                    "legal_name": "Acme Limited",
                                    "website": "https://acme.example",
                                },
                            }
                        ]
                    }
                )
            }
            return FakeResponse(response_payload)

    json_module = json
    monkeypatch.setattr("app.services.openai_cde_service.httpx.AsyncClient", FakeClient)

    records = [{"company_name": "Acme Ltd", "website": ""}]
    result = await openai_cde_service.extract_dataset_data(
        records=records,
        requested_fields=["legal_name", "website"],
        workflow_ids=["company_data"],
    )

    assert captured["url"].endswith("/v1/responses")
    assert captured["body"]["model"] == "gpt-4o-mini"
    assert "response_format" not in captured["body"]
    assert "web_search" in captured["body"]["tools"][0]["type"]
    assert result[0]["entity"] == "Acme Ltd"
    assert result[0]["extracted"]["website"] == "https://acme.example"
    assert result[0]["extracted"]["legal_name"] == "Acme Limited"


@pytest.mark.asyncio
async def test_extract_dataset_data_accepts_direct_object_response(monkeypatch):
    monkeypatch.setattr("app.services.openai_cde_service.settings.OPENAI_API_KEY", "test-key")

    class FakeResponse:
        def __init__(self, payload: dict[str, object], status_code: int = 200):
            self._payload = payload
            self.status_code = status_code
            self.text = json.dumps(payload)

        @property
        def is_success(self) -> bool:
            return 200 <= self.status_code < 300

        def json(self) -> dict[str, object]:
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers=None, json=None):
            return FakeResponse(
                {
                    "output_text": json_module.dumps(
                        {
                            "website": "https://acme.example",
                            "description": "Example company",
                        }
                    )
                }
            )

    json_module = json
    monkeypatch.setattr("app.services.openai_cde_service.httpx.AsyncClient", FakeClient)

    records = [{"company_name": "Acme Ltd", "website": ""}]
    result = await openai_cde_service.extract_dataset_data(
        records=records,
        requested_fields=["website", "description"],
        workflow_ids=["company_data"],
    )

    assert result[0]["extracted"]["website"] == "https://acme.example"
    assert result[0]["extracted"]["description"] == "Example company"
