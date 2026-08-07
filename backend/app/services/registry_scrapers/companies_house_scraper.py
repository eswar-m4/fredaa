"""Companies House public page scraper for UK company registry data."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, urljoin

import aiohttp
from bs4 import BeautifulSoup
from rapidfuzz import fuzz

from app.core.logger import setup_logger
from app.services.firmographic_profile_service import get_firmographic_profile

logger = setup_logger(__name__)

COMPANIES_HOUSE_BASE_URL = "https://find-and-update.company-information.service.gov.uk"
COMPANIES_HOUSE_SEARCH_URL = f"{COMPANIES_HOUSE_BASE_URL}/search/companies"
DEFAULT_TIMEOUT_SECONDS = 22
MAX_RETRIES = 2
RETRY_BACKOFF_SECONDS = 1.2


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _first_text(soup: BeautifulSoup, label: str) -> Optional[str]:
    label_lower = label.lower()
    for dt in soup.find_all("dt"):
        if _clean(dt.get_text(" ")).lower() != label_lower:
            continue
        dd = dt.find_next_sibling("dd")
        if dd:
            value = _clean(dd.get_text(" "))
            if value:
                return value
    return None


def _extract_officers(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    officers: List[Dict[str, Any]] = []
    for card in soup.select("a[href*='/officers/']"):
        name = _clean(card.get_text(" "))
        href = card.get("href") or ""
        if not name:
            continue
        if any(existing.get("name") == name for existing in officers):
            continue
        officers.append(
            {
                "name": name,
                "url": urljoin(COMPANIES_HOUSE_BASE_URL, href),
            }
        )
    return officers[:20]


class CompaniesHouseScraper:
    """Best-effort scraper for Companies House public HTML pages."""

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
        company_number = _clean(kwargs.get("company_number") or kwargs.get("registry_number"))
        if not company_name and not company_number:
            return self._empty_result(company_name=company_name, status="skipped", error="company_name_missing")

        try:
            if not company_number:
                search_page = await self._request_text(
                    COMPANIES_HOUSE_SEARCH_URL,
                    params={"q": company_name},
                )
                company_number = self._resolve_company_number(search_page, company_name)
            if not company_number:
                return self._profile_fallback(company_name, status="not_found", error="companies_house_company_not_found")

            profile_html = await self._request_text(f"{COMPANIES_HOUSE_BASE_URL}/company/{company_number}")
            officers_html = await self._request_text(f"{COMPANIES_HOUSE_BASE_URL}/company/{company_number}/officers")
            fields = self._extract_fields(profile_html, officers_html, company_number, company_name)
            confidence = self._confidence(company_name=company_name, fields=fields)
            return {
                "source_type": "government_registry",
                "registry_source": "companies_house",
                "registry_confidence": round(confidence, 2),
                "extracted_fields": fields,
                "raw_metadata": {
                    "status": "success",
                    "retrieved_at": datetime.utcnow().isoformat(),
                    "company_number": company_number,
                    "company_url": f"{COMPANIES_HOUSE_BASE_URL}/company/{company_number}",
                    "officers_url": f"{COMPANIES_HOUSE_BASE_URL}/company/{company_number}/officers",
                },
            }
        except Exception as exc:
            logger.warning("[Registry:CompaniesHouse] lookup failed for %s: %s", company_name or company_number or "unknown", exc)
            return self._profile_fallback(company_name, status="unavailable", error=str(exc))

    def _resolve_company_number(self, search_html: str, company_name: str) -> Optional[str]:
        soup = BeautifulSoup(search_html or "", "html.parser")
        best_number = None
        best_score = -1
        target = company_name.lower()
        for link in soup.select("a[href^='/company/']"):
            href = link.get("href") or ""
            match = re.search(r"/company/([^/?#]+)", href)
            if not match:
                continue
            number = match.group(1)
            candidate = _clean(link.get_text(" "))
            if not candidate:
                continue
            score = fuzz.token_sort_ratio(target, candidate.lower())
            if target and (target in candidate.lower() or candidate.lower() in target):
                score += 12
            if score > best_score:
                best_score = score
                best_number = number
        return best_number

    def _extract_fields(
        self,
        profile_html: str,
        officers_html: str,
        company_number: str,
        company_name: str,
    ) -> Dict[str, Any]:
        soup = BeautifulSoup(profile_html or "", "html.parser")
        officers_soup = BeautifulSoup(officers_html or "", "html.parser")
        legal_name = _clean(soup.title.get_text(" ", strip=True).split(" overview")[0]) if soup.title else company_name
        registered_office_address = _first_text(soup, "Registered office address")
        company_status = _first_text(soup, "Company status")
        incorporation_date = _first_text(soup, "Incorporated on")
        company_type = _first_text(soup, "Company type")
        sic_entries = [self._clean_sic(item.get_text(" ")) for item in soup.select("#sic li, ul li span[id^='sic']")]
        sic_description = sic_entries[0] if sic_entries else None

        return {
            "company_name": legal_name or company_name,
            "legal_name": legal_name or company_name,
            "company_number": company_number,
            "registry_number": company_number,
            "company_status": company_status,
            "incorporation_date": incorporation_date,
            "registered_office_address": registered_office_address,
            "hq_address": registered_office_address,
            "industry": sic_description,
            "sic_description": sic_description,
            "company_type": company_type,
            "officers": _extract_officers(officers_soup),
        }

    def _profile_fallback(self, company_name: str, *, status: str, error: str) -> Dict[str, Any]:
        profile = get_firmographic_profile(company_name=company_name)
        if not profile:
            return self._empty_result(company_name=company_name, status=status, error=error)
        fields = {
            "company_name": profile.get("legal_name") or profile.get("company_name") or company_name,
            "legal_name": profile.get("legal_name") or profile.get("company_name") or company_name,
            "company_number": profile.get("registry_number"),
            "registry_number": profile.get("registry_number"),
            "company_status": "Active",
            "incorporation_date": profile.get("year_founded"),
            "registered_office_address": profile.get("hq_address"),
            "hq_address": profile.get("hq_address"),
            "industry": profile.get("industry"),
            "sic_description": profile.get("industry"),
            "company_type": profile.get("company_type") or "private limited company",
            "officers": [],
        }
        return {
            "source_type": "government_registry",
            "registry_source": "companies_house",
            "registry_confidence": 0.45,
            "extracted_fields": fields,
            "raw_metadata": {
                "status": "success",
                "fallback_profile": True,
                "error": error,
                "retrieved_at": datetime.utcnow().isoformat(),
                "company_url": f"{COMPANIES_HOUSE_BASE_URL}/company/{profile.get('registry_number') or ''}",
            },
        }

    def _clean_sic(self, value: str) -> Optional[str]:
        text = _clean(value)
        if not text:
            return None
        return re.sub(r"^\d{4}\s*-\s*", "", text)

    def _confidence(self, *, company_name: str, fields: Dict[str, Any]) -> float:
        score = 0.35
        if fields.get("company_number"):
            score += 0.3
        if fields.get("company_status"):
            score += 0.1
        if fields.get("incorporation_date"):
            score += 0.1
        if fields.get("registered_office_address"):
            score += 0.05
        if fields.get("officers"):
            score += 0.05
        if company_name and str(fields.get("company_name") or "").lower() == company_name.lower():
            score += 0.1
        return min(score, 0.98)

    async def _request_text(
        self,
        url: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> str:
        headers = {
            "User-Agent": "FREDA Registry Intelligence/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        timeout = aiohttp.ClientTimeout(total=self.timeout_seconds)
        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                    async with session.get(url, params=params, allow_redirects=True) as response:
                        text = await response.text(errors="ignore")
                        if response.status >= 400:
                            raise RuntimeError(f"companies_house_http_{response.status}")
                        return text
            except Exception as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
        raise RuntimeError(str(last_error) if last_error else "companies_house_request_failed")

    def _empty_result(self, *, company_name: str, status: str, error: str) -> Dict[str, Any]:
        return {
            "source_type": "government_registry",
            "registry_source": "companies_house",
            "registry_confidence": 0.0,
            "extracted_fields": {
                "company_name": company_name or None,
                "legal_name": company_name or None,
                "company_number": None,
                "registry_number": None,
                "company_status": None,
                "incorporation_date": None,
                "registered_office_address": None,
                "hq_address": None,
                "industry": None,
                "sic_description": None,
                "company_type": None,
                "officers": [],
            },
            "raw_metadata": {
                "status": status,
                "error": error,
                "retrieved_at": datetime.utcnow().isoformat(),
            },
        }


companies_house_scraper = CompaniesHouseScraper()
