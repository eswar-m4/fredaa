"""GLEIF / LEI search scraper for public legal-entity data."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import aiohttp
from rapidfuzz import fuzz

from app.core.logger import setup_logger

logger = setup_logger(__name__)

GLEIF_API_BASE_URL = "https://api.gleif.org/api/v1"
GLEIF_LEI_RECORDS_URL = f"{GLEIF_API_BASE_URL}/lei-records"
DEFAULT_TIMEOUT_SECONDS = 20
MAX_RETRIES = 2
RETRY_BACKOFF_SECONDS = 1.2


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _format_address(address: Optional[Dict[str, Any]]) -> Optional[str]:
    if not isinstance(address, dict):
        return None
    parts: List[str] = []
    for key in ("addressLines", "city", "region", "postalCode", "country"):
        value = address.get(key)
        if isinstance(value, list):
            parts.extend([_clean(item) for item in value if _clean(item)])
        elif value:
            parts.append(_clean(value))
    text = ", ".join([part for part in parts if part])
    return text or None


def _first_non_empty(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


class GLEIFScraper:
    """Best-effort lookup against the public GLEIF API."""

    def __init__(
        self,
        *,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries

    async def lookup_company(self, company_name: str, **kwargs: Any) -> Dict[str, Any]:
        company_name = _clean(company_name)
        lei = _clean(kwargs.get("lei") or kwargs.get("lei_number") or kwargs.get("registry_number"))
        if not company_name and not lei:
            return self._empty_result(company_name=company_name, status="skipped", error="company_name_missing")

        try:
            record = await self._resolve_record(company_name, lei=lei)
            if not record:
                return self._empty_result(company_name=company_name, status="not_found", error="gleif_record_not_found")
            fields = await self._extract_fields(record)
            confidence = self._confidence(company_name=company_name, fields=fields, lei=lei)
            return {
                "source_type": "government_registry",
                "registry_source": "gleif",
                "registry_confidence": round(confidence, 2),
                "extracted_fields": fields,
                "raw_metadata": {
                    "status": "success",
                    "retrieved_at": datetime.utcnow().isoformat(),
                    "search_strategy": "lei" if lei else "legal_name",
                    "source_url": record.get("links", {}).get("self") or GLEIF_LEI_RECORDS_URL,
                },
            }
        except Exception as exc:
            logger.warning("[Registry:GLEIF] lookup failed for %s: %s", company_name or lei or "unknown", exc)
            return self._empty_result(
                company_name=company_name,
                status="unavailable",
                error=str(exc),
            )

    async def _resolve_record(self, company_name: str, *, lei: str) -> Optional[Dict[str, Any]]:
        if lei:
            record = await self._request_json(f"{GLEIF_LEI_RECORDS_URL}/{lei}")
            return (record or {}).get("data") or None

        params = {
            "filter[entity.legalName]": company_name,
            "sort": "-registration.status",
            "page[size]": "10",
        }
        payload = await self._request_json(GLEIF_LEI_RECORDS_URL, params=params)
        candidates = (payload or {}).get("data") or []
        if not candidates:
            return None

        best: Optional[Dict[str, Any]] = None
        best_score = -1
        target = company_name.lower()
        for candidate in candidates:
            entity = (candidate.get("attributes") or {}).get("entity") or {}
            legal_name = _clean((entity.get("legalName") or {}).get("name"))
            lower_name = legal_name.lower()
            score = fuzz.token_sort_ratio(target, lower_name)
            if target and (target in lower_name or lower_name in target):
                score += 15
            if score > best_score:
                best = candidate
                best_score = score
        return best

    async def _extract_fields(self, record: Dict[str, Any]) -> Dict[str, Any]:
        attributes = record.get("attributes") or {}
        entity = attributes.get("entity") or {}
        registration = attributes.get("registration") or {}
        direct_parent = await self._resolve_relationship(record, "direct-parent")
        ultimate_parent = await self._resolve_relationship(record, "ultimate-parent")

        legal_name = _first_non_empty(
            (entity.get("legalName") or {}).get("name"),
            (entity.get("associatedEntity") or {}).get("name"),
        )
        legal_address = _format_address(entity.get("legalAddress"))
        hq_address = _format_address(entity.get("headquartersAddress"))

        fields: Dict[str, Any] = {
            "company_name": legal_name,
            "legal_name": legal_name,
            "lei": attributes.get("lei"),
            "registry_number": attributes.get("lei"),
            "company_status": entity.get("status"),
            "status": entity.get("status"),
            "legal_form": (entity.get("legalForm") or {}).get("id") or (entity.get("legalForm") or {}).get("other"),
            "incorporation_date": self._date_only(registration.get("initialRegistrationDate") or entity.get("creationDate")),
            "registration_date": registration.get("initialRegistrationDate"),
            "last_update_date": registration.get("lastUpdateDate"),
            "hq_address": hq_address or legal_address,
            "legal_address": legal_address,
            "hq_city": (entity.get("headquartersAddress") or {}).get("city") or (entity.get("legalAddress") or {}).get("city"),
            "hq_country": (entity.get("headquartersAddress") or {}).get("country") or entity.get("jurisdiction"),
            "jurisdiction": entity.get("jurisdiction"),
            "registered_as": entity.get("registeredAs"),
            "managing_lou": registration.get("managingLou"),
            "corroboration_level": registration.get("corroborationLevel"),
            "parent_company": (direct_parent or {}).get("name"),
            "parent_lei": (direct_parent or {}).get("lei"),
            "ultimate_parent_company": (ultimate_parent or {}).get("name"),
            "ultimate_parent_lei": (ultimate_parent or {}).get("lei"),
        }
        return fields

    async def _resolve_relationship(self, record: Dict[str, Any], relation_key: str) -> Optional[Dict[str, Any]]:
        relation = ((record.get("relationships") or {}).get(relation_key) or {}).get("links") or {}
        related_url = relation.get("related")
        if not related_url:
            return None
        payload = await self._request_json(related_url)
        data = (payload or {}).get("data")
        if isinstance(data, dict):
            attrs = data.get("attributes") or {}
            entity = attrs.get("entity") or {}
            return {
                "lei": attrs.get("lei"),
                "name": (entity.get("legalName") or {}).get("name"),
            }
        return None

    async def _request_json(self, url: str, *, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        headers = {
            "User-Agent": "FREDA Registry Intelligence/1.0",
            "Accept": "application/json,text/plain,*/*",
        }
        timeout = aiohttp.ClientTimeout(total=self.timeout_seconds)
        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                    async with session.get(url, params=params, allow_redirects=True) as response:
                        text = await response.text(errors="ignore")
                        if response.status >= 400:
                            raise RuntimeError(f"gleif_http_{response.status}")
                        try:
                            return await response.json(content_type=None)
                        except Exception:
                            import json

                            return json.loads(text)
            except Exception as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
        raise RuntimeError(str(last_error) if last_error else "gleif_request_failed")

    def _confidence(self, *, company_name: str, fields: Dict[str, Any], lei: str) -> float:
        score = 0.35
        if lei:
            score += 0.4
        if fields.get("company_name"):
            score += 0.1
        if fields.get("hq_address"):
            score += 0.05
        if fields.get("company_status"):
            score += 0.05
        if fields.get("parent_company") or fields.get("ultimate_parent_company"):
            score += 0.05
        if company_name and str(fields.get("company_name") or "").lower() == company_name.lower():
            score += 0.1
        return min(score, 0.98)

    def _date_only(self, value: Any) -> Any:
        text = _clean(value)
        return text[:10] if len(text) >= 10 else (text or None)

    def _empty_result(self, *, company_name: str, status: str, error: str) -> Dict[str, Any]:
        return {
            "source_type": "government_registry",
            "registry_source": "gleif",
            "registry_confidence": 0.0,
            "extracted_fields": {
                "company_name": company_name or None,
                "legal_name": company_name or None,
                "lei": None,
                "registry_number": None,
                "company_status": None,
                "legal_form": None,
                "incorporation_date": None,
                "hq_address": None,
                "legal_address": None,
                "hq_city": None,
                "hq_country": None,
                "jurisdiction": None,
                "parent_company": None,
                "parent_lei": None,
                "ultimate_parent_company": None,
                "ultimate_parent_lei": None,
            },
            "raw_metadata": {
                "status": status,
                "error": error,
                "retrieved_at": datetime.utcnow().isoformat(),
            },
        }


gleif_scraper = GLEIFScraper()
