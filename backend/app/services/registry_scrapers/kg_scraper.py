"""Google Knowledge Graph Search API scraper for firmographic enrichment."""

from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any, Dict, Optional

import aiohttp
from rapidfuzz import fuzz

from app.core.logger import setup_logger

logger = setup_logger(__name__)

KG_SEARCH_URL = "https://kgsearch.googleapis.com/v1/entities:search"
DEFAULT_TIMEOUT_SECONDS = 15


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _resolve_api_key() -> Optional[str]:
    key = os.environ.get("GOOGLE_KG_API_KEY")
    if key:
        return key
    try:
        from app.config import settings
        return getattr(settings, "GOOGLE_KG_API_KEY", None)
    except Exception:
        return None


class GoogleKGScraper:
    """Best-effort scraper using the Google Knowledge Graph Search API."""

    def __init__(self, *, timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.timeout_seconds = timeout_seconds

    async def lookup_company(self, company_name: str, **kwargs: Any) -> Dict[str, Any]:
        company_name = _clean(company_name)
        if not company_name:
            return self._empty_result(company_name=company_name, status="skipped", error="company_name_missing")

        api_key = _resolve_api_key()
        if not api_key:
            logger.warning("[Registry:GoogleKG] GOOGLE_KG_API_KEY not configured — skipping lookup for %s", company_name)
            return self._empty_result(company_name=company_name, status="skipped", error="api_key_not_configured")

        try:
            params = {
                "query": company_name,
                "key": api_key,
                "types": "Organization,Corporation,LocalBusiness",
                "limit": 5,
                "indent": "true",
            }
            timeout = aiohttp.ClientTimeout(total=self.timeout_seconds)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(KG_SEARCH_URL, params=params) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        logger.warning("[Registry:GoogleKG] API error %s for %s: %s", resp.status, company_name, body[:200])
                        return self._empty_result(company_name=company_name, status="api_error", error=f"http_{resp.status}")
                    payload = await resp.json()

            item = self._best_match(payload, company_name)
            if not item:
                return self._empty_result(company_name=company_name, status="not_found", error="no_kg_match")

            fields = self._extract_fields(item, company_name)
            confidence = self._confidence(company_name, fields)
            kg_id = item.get("@id", "")
            mid = kg_id.replace("kg:/", "").strip("/") if kg_id else ""

            return {
                "source_type": "knowledge_graph",
                "registry_source": "google_kg",
                "registry_confidence": round(confidence, 2),
                "extracted_fields": fields,
                "raw_metadata": {
                    "status": "success",
                    "retrieved_at": datetime.utcnow().isoformat(),
                    "kg_id": kg_id,
                    "mid": mid,
                    "source_url": f"https://www.google.com/search?kgmid={mid}" if mid else "",
                },
            }
        except Exception as exc:
            logger.warning("[Registry:GoogleKG] lookup failed for %s: %s", company_name, exc)
            return self._empty_result(company_name=company_name, status="unavailable", error=str(exc))

    def _best_match(self, payload: Dict[str, Any], company_name: str) -> Optional[Dict[str, Any]]:
        items = payload.get("itemListElement") or []
        if not items:
            return None

        target = company_name.lower()
        best_item = None
        best_score = -1

        for element in items:
            result = element.get("result") or {}
            name = _clean(result.get("name")).lower()
            result_score = float(element.get("resultScore") or 0)
            fuzzy_score = fuzz.token_sort_ratio(target, name)
            combined = fuzzy_score + (result_score / 100.0)
            if target in name or name in target:
                combined += 20
            types = result.get("@type") or []
            if isinstance(types, str):
                types = [types]
            if any(t in ("Organization", "Corporation", "LocalBusiness", "Company") for t in types):
                combined += 10
            if combined > best_score:
                best_score = combined
                best_item = result

        if best_score < 40:
            return None
        return best_item

    def _extract_fields(self, item: Dict[str, Any], company_name: str) -> Dict[str, Any]:
        fields: Dict[str, Any] = {}

        name = _clean(item.get("name"))
        if name:
            fields["company_name"] = name

        description = _clean(
            item.get("description")
            or (item.get("detailedDescription") or {}).get("articleBody")
        )
        if description:
            fields["description"] = description[:500]

        url = _clean(item.get("url"))
        if url:
            fields["website"] = url

        address = item.get("location") or item.get("address") or {}
        if isinstance(address, dict):
            country = _clean(address.get("addressCountry") or address.get("country"))
            city = _clean(address.get("addressLocality") or address.get("city"))
            state = _clean(address.get("addressRegion") or address.get("state"))
            if country:
                fields["hq_country"] = country
            if city:
                fields["hq_city"] = city
            if state:
                fields["hq_state"] = state

        founding_date = _clean(item.get("foundingDate"))
        if founding_date:
            fields["year_founded"] = founding_date[:4] if len(founding_date) >= 4 else founding_date

        employee_count = item.get("numberOfEmployees")
        if isinstance(employee_count, dict):
            employee_count = employee_count.get("value")
        if employee_count:
            fields["employee_count"] = str(employee_count)

        same_as = item.get("sameAs") or []
        if isinstance(same_as, str):
            same_as = [same_as]
        for link in same_as:
            link = str(link)
            if "wikidata.org" in link:
                qid = link.rstrip("/").split("/")[-1]
                if qid.startswith("Q"):
                    fields["wikidata_qid"] = qid

        return fields

    def _confidence(self, company_name: str, fields: Dict[str, Any]) -> float:
        score = 0.0
        matched_name = _clean(fields.get("company_name")).lower()
        target = company_name.lower()
        if matched_name:
            ratio = fuzz.token_sort_ratio(target, matched_name) / 100.0
            score += ratio * 0.6
        score += min(len(fields) / 10.0, 0.3)
        if fields.get("website"):
            score += 0.05
        if fields.get("description"):
            score += 0.05
        return min(score, 1.0)

    def _empty_result(self, *, company_name: str, status: str, error: str) -> Dict[str, Any]:
        return {
            "source_type": "knowledge_graph",
            "registry_source": "google_kg",
            "registry_confidence": 0.0,
            "extracted_fields": {},
            "raw_metadata": {
                "status": status,
                "error": error,
                "company_name": company_name,
                "retrieved_at": datetime.utcnow().isoformat(),
            },
        }


kg_scraper = GoogleKGScraper()
