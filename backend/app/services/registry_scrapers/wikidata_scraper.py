"""Wikidata public knowledge graph scraper for firmographic enrichment."""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import aiohttp
from rapidfuzz import fuzz

from app.core.logger import setup_logger

logger = setup_logger(__name__)

WIKIDATA_SEARCH_URL = "https://www.wikidata.org/w/api.php"
WIKIDATA_ENTITY_DATA_URL = "https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
DEFAULT_TIMEOUT_SECONDS = 20
MAX_RETRIES = 2
RETRY_BACKOFF_SECONDS = 1.0

PROPERTY_MAP = {
    "P856": "website",
    "P571": "year_founded",
    "P159": "hq_address",
    "P17": "hq_country",
    "P452": "industry",
    "P1128": "employee_count",
    "P2139": "annual_revenue",
    "P749": "parent_company",
    "P355": "subsidiaries",
    "P112": "founder",
}


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _first_non_empty(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


class WikidataScraper:
    """Best-effort scraper for public Wikidata company facts."""

    def __init__(
        self,
        *,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self._label_cache: Dict[str, str] = {}

    async def lookup_company(self, company_name: str, **kwargs: Any) -> Dict[str, Any]:
        company_name = _clean(company_name)
        qid = _clean(kwargs.get("qid") or kwargs.get("wikidata_qid"))
        if not company_name and not qid:
            return self._empty_result(company_name=company_name, status="skipped", error="company_name_missing")

        try:
            if not qid:
                qid = await self._search_entity(company_name)
            if not qid:
                return self._empty_result(company_name=company_name, status="not_found", error="wikidata_entity_not_found")
            entity = await self._request_json(WIKIDATA_ENTITY_DATA_URL.format(qid=qid))
            fields = await self._extract_fields(entity, qid, company_name)
            confidence = self._confidence(company_name=company_name, fields=fields)
            return {
                "source_type": "knowledge_graph",
                "registry_source": "wikidata",
                "registry_confidence": round(confidence, 2),
                "extracted_fields": fields,
                "raw_metadata": {
                    "status": "success",
                    "retrieved_at": datetime.utcnow().isoformat(),
                    "qid": qid,
                    "source_url": f"https://www.wikidata.org/wiki/{qid}",
                },
            }
        except Exception as exc:
            logger.warning("[Registry:Wikidata] lookup failed for %s: %s", company_name or qid or "unknown", exc)
            return self._empty_result(
                company_name=company_name,
                status="unavailable",
                error=str(exc),
            )

    async def _search_entity(self, company_name: str) -> Optional[str]:
        params = {
            "action": "wbsearchentities",
            "search": company_name,
            "language": "en",
            "format": "json",
            "limit": 10,
            "type": "item",
        }
        payload = await self._request_json(WIKIDATA_SEARCH_URL, params=params)
        candidates = payload.get("search") or []
        if not candidates:
            return None

        best_qid = None
        best_score = -1
        target = company_name.lower()
        for candidate in candidates:
            label = _clean(candidate.get("label")).lower()
            description = _clean(candidate.get("description")).lower()
            score = fuzz.token_sort_ratio(target, label)
            if target and (target in label or label in target):
                score += 15
            if "company" in description or "corporation" in description or "business" in description:
                score += 5
            if score > best_score:
                best_score = score
                best_qid = candidate.get("id")
        return best_qid

    async def _extract_fields(self, entity_payload: Dict[str, Any], qid: str, company_name: str) -> Dict[str, Any]:
        entity = (((entity_payload or {}).get("entities") or {}).get(qid)) or {}
        claims = entity.get("claims") or {}
        labels = entity.get("labels") or {}
        descriptions = entity.get("descriptions") or {}
        en_label = (labels.get("en") or {}).get("value") or company_name
        en_description = (descriptions.get("en") or {}).get("value")

        website = await self._claim_url(claims.get("P856"))
        founded_year = await self._claim_year(claims.get("P571"))
        hq_address = await self._claim_label(claims.get("P159"))
        hq_country = await self._claim_label(claims.get("P17"))
        industry = await self._claim_label(claims.get("P452"))
        employees = await self._claim_amount(claims.get("P1128"))
        revenue = await self._claim_amount(claims.get("P2139"))
        parent_company = await self._claim_label(claims.get("P749"))
        subsidiaries = await self._claim_labels(claims.get("P355"))
        founder = await self._claim_labels(claims.get("P112"))

        return {
            "company_name": en_label,
            "legal_name": en_label,
            "description": en_description,
            "website": website,
            "year_founded": founded_year,
            "hq_address": hq_address,
            "hq_country": hq_country,
            "industry": industry,
            "employee_count": employees,
            "employees": employees,
            "annual_revenue": revenue,
            "parent_company": parent_company,
            "subsidiaries": subsidiaries,
            "founder": founder,
            "wikidata_qid": qid,
        }

    async def _claim_url(self, claims: Any) -> Optional[str]:
        values = await self._claim_labels(claims)
        for value in values:
            if value.startswith("http"):
                return value
        return values[0] if values else None

    async def _claim_year(self, claims: Any) -> Optional[int]:
        value = await self._claim_values(claims)
        for item in value:
            if isinstance(item, str) and re.match(r"^\d{4}", item):
                return int(item[:4])
        return None

    async def _claim_amount(self, claims: Any) -> Optional[str]:
        values = await self._claim_values(claims)
        if not values:
            return None
        return values[0]

    async def _claim_label(self, claims: Any) -> Optional[str]:
        labels = await self._claim_labels(claims)
        return labels[0] if labels else None

    async def _claim_labels(self, claims: Any) -> List[str]:
        values = await self._claim_values(claims)
        return [str(value) for value in values if value not in (None, "")]

    async def _claim_values(self, claims: Any) -> List[Any]:
        values: List[Any] = []
        for claim in claims or []:
            mainsnak = claim.get("mainsnak") or {}
            datavalue = mainsnak.get("datavalue") or {}
            value = datavalue.get("value")
            if value is None:
                continue
            if isinstance(value, dict):
                if "time" in value:
                    values.append(str(value.get("time") or "")[1:5] or None)
                elif "id" in value:
                    label = await self._resolve_entity_label(str(value.get("id") or ""))
                    values.append(label or value.get("id"))
                elif "text" in value:
                    values.append(value.get("text"))
                elif "amount" in value:
                    amount = value.get("amount")
                    unit = value.get("unit")
                    values.append(f"{amount} {unit}".strip() if unit not in (None, "", "1") else str(amount))
                elif "latitude" in value and "longitude" in value:
                    values.append(f"{value.get('latitude')}, {value.get('longitude')}")
                else:
                    values.append(next((v for v in value.values() if v not in (None, "")), None))
            else:
                values.append(value)
        return [item for item in values if item not in (None, "", [])]

    async def _resolve_entity_label(self, qid: str) -> Optional[str]:
        qid = _clean(qid)
        if not qid:
            return None
        if qid in self._label_cache:
            return self._label_cache[qid]
        try:
            payload = await self._request_json(
                "https://www.wikidata.org/w/api.php",
                params={
                    "action": "wbgetentities",
                    "ids": qid,
                    "languages": "en",
                    "props": "labels",
                    "format": "json",
                },
            )
            entity = ((payload or {}).get("entities") or {}).get(qid) or {}
            label = ((entity.get("labels") or {}).get("en") or {}).get("value")
            if label:
                self._label_cache[qid] = label
                return label
        except Exception:
            return None
        return None

    def _confidence(self, *, company_name: str, fields: Dict[str, Any]) -> float:
        score = 0.28
        if fields.get("website"):
            score += 0.08
        if fields.get("industry"):
            score += 0.08
        if fields.get("hq_address"):
            score += 0.08
        if fields.get("year_founded"):
            score += 0.05
        if fields.get("employee_count"):
            score += 0.04
        if fields.get("parent_company") or fields.get("subsidiaries"):
            score += 0.05
        if company_name and str(fields.get("company_name") or "").lower() == company_name.lower():
            score += 0.12
        return min(score, 0.9)

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
                            raise RuntimeError(f"wikidata_http_{response.status}")
                        try:
                            return await response.json(content_type=None)
                        except Exception:
                            return json.loads(text)
            except Exception as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
        raise RuntimeError(str(last_error) if last_error else "wikidata_request_failed")

    def _empty_result(self, *, company_name: str, status: str, error: str) -> Dict[str, Any]:
        return {
            "source_type": "knowledge_graph",
            "registry_source": "wikidata",
            "registry_confidence": 0.0,
            "extracted_fields": {
                "company_name": company_name or None,
                "legal_name": company_name or None,
                "description": None,
                "website": None,
                "year_founded": None,
                "hq_address": None,
                "hq_country": None,
                "industry": None,
                "employee_count": None,
                "employees": None,
                "annual_revenue": None,
                "parent_company": None,
                "subsidiaries": [],
                "founder": None,
            },
            "raw_metadata": {
                "status": status,
                "error": error,
                "retrieved_at": datetime.utcnow().isoformat(),
            },
        }


wikidata_scraper = WikidataScraper()
