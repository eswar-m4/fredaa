"""
MCA India registry scraper.

This module is intentionally separate from the website scraper. MCA frequently
changes public endpoints and may apply bot controls, so this service exposes a
stable normalized contract while treating network retrieval as best-effort.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

import aiohttp
from bs4 import BeautifulSoup

from app.core.logger import setup_logger

logger = setup_logger(__name__)

MCA_BASE_URL = "https://www.mca.gov.in"
MCA_COMPANY_MASTER_SEARCH_URL = (
    "https://www.mca.gov.in/mcafoportal/showCheckCompanyName.do"
)
DEFAULT_TIMEOUT_SECONDS = 18
MAX_RETRIES = 2
RETRY_BACKOFF_SECONDS = 1.25
BLOCK_PATTERNS = re.compile(
    r"(captcha|access denied|forbidden|temporarily unavailable|too many requests|bot)",
    re.IGNORECASE,
)
CIN_PATTERN = re.compile(r"\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b")


def _empty_result(
    *,
    company_name: str,
    confidence: float,
    status: str,
    error: Optional[str] = None,
    raw_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "source_type": "government_registry",
        "registry_source": "mca_india",
        "registry_confidence": round(confidence, 2),
        "extracted_fields": {
            "company_name": company_name or None,
            "cin": None,
            "company_status": None,
            "incorporation_date": None,
            "directors": [],
            "registered_office_address": None,
        },
        "raw_metadata": {
            "status": status,
            "error": error,
            "retrieved_at": datetime.utcnow().isoformat(),
            **(raw_metadata or {}),
        },
    }


def _normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _confidence_for_fields(fields: Dict[str, Any], *, blocked: bool = False) -> float:
    if blocked:
        return 0.15
    score = 0.2
    if fields.get("cin"):
        score += 0.25
    if fields.get("company_status"):
        score += 0.15
    if fields.get("incorporation_date"):
        score += 0.15
    if fields.get("registered_office_address"):
        score += 0.15
    if fields.get("directors"):
        score += 0.1
    return min(score, 0.95)


class MCAScraper:
    """Best-effort asynchronous MCA lookup and metadata extraction."""

    def __init__(
        self,
        *,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries

    async def lookup_company(self, company_name: str, **_: Any) -> Dict[str, Any]:
        company_name = _normalize_text(company_name)
        if not company_name:
            return _empty_result(
                company_name=company_name,
                confidence=0.0,
                status="skipped",
                error="company_name_missing",
            )

        params = {"companyname": company_name}
        url = MCA_COMPANY_MASTER_SEARCH_URL
        try:
            text = await self._request_text(url, params=params)
        except Exception as exc:
            logger.warning("[Registry:MCA] lookup failed for %s: %s", company_name, exc)
            return _empty_result(
                company_name=company_name,
                confidence=0.0,
                status="unavailable",
                error=str(exc),
                raw_metadata={"lookup_url": f"{url}?companyname={quote_plus(company_name)}"},
            )

        if BLOCK_PATTERNS.search(text or ""):
            logger.info("[Registry:MCA] anti-block page detected for %s", company_name)
            return _empty_result(
                company_name=company_name,
                confidence=0.15,
                status="blocked",
                error="anti_block_detected",
                raw_metadata={"lookup_url": f"{url}?companyname={quote_plus(company_name)}"},
            )

        fields = self._parse_company_master(text, company_name)
        confidence = _confidence_for_fields(fields)
        return {
            "source_type": "government_registry",
            "registry_source": "mca_india",
            "registry_confidence": round(confidence, 2),
            "extracted_fields": fields,
            "raw_metadata": {
                "status": "success" if confidence >= 0.35 else "partial",
                "lookup_url": f"{url}?companyname={quote_plus(company_name)}",
                "retrieved_at": datetime.utcnow().isoformat(),
                "parser": "mca_company_master_html",
            },
        }

    async def _request_text(
        self,
        url: str,
        *,
        params: Optional[Dict[str, Any]] = None,
    ) -> str:
        headers = {
            "User-Agent": "FREDA Registry Intelligence/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.8",
            "Referer": MCA_BASE_URL,
        }
        timeout = aiohttp.ClientTimeout(total=self.timeout_seconds)
        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                    async with session.get(url, params=params, allow_redirects=True) as response:
                        text = await response.text(errors="ignore")
                        if response.status in (403, 429):
                            raise RuntimeError(f"anti_block_status_{response.status}")
                        if response.status >= 500:
                            raise RuntimeError(f"mca_http_{response.status}")
                        return text
            except Exception as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
        raise RuntimeError(str(last_error) if last_error else "mca_request_failed")

    def _parse_company_master(self, html: str, company_name: str) -> Dict[str, Any]:
        soup = BeautifulSoup(html or "", "html.parser")
        text = _normalize_text(soup.get_text(" "))
        cin_match = CIN_PATTERN.search(text)

        fields = {
            "company_name": self._extract_label_value(soup, ["Company Name", "Company"]) or company_name,
            "cin": cin_match.group(0) if cin_match else self._extract_label_value(soup, ["CIN", "LLPIN"]),
            "company_status": self._extract_label_value(
                soup,
                ["Company Status", "Status", "Company/LLP Status"],
            ),
            "incorporation_date": self._extract_label_value(
                soup,
                ["Date of Incorporation", "Incorporation Date"],
            ),
            "directors": self._extract_directors(soup),
            "registered_office_address": self._extract_label_value(
                soup,
                ["Registered Office Address", "Registered Address", "Address"],
            ),
        }
        return fields

    def _extract_label_value(self, soup: BeautifulSoup, labels: List[str]) -> Optional[str]:
        label_pattern = re.compile("|".join(re.escape(label) for label in labels), re.IGNORECASE)
        for node in soup.find_all(string=label_pattern):
            parent = node.parent
            if not parent:
                continue
            sibling = parent.find_next_sibling()
            if sibling:
                value = _normalize_text(sibling.get_text(" "))
                if value and not label_pattern.fullmatch(value):
                    return value
            row = parent.find_parent("tr")
            if row:
                cells = [_normalize_text(cell.get_text(" ")) for cell in row.find_all(["td", "th"])]
                for idx, cell in enumerate(cells):
                    if label_pattern.search(cell) and idx + 1 < len(cells):
                        return cells[idx + 1] or None
        return None

    def _extract_directors(self, soup: BeautifulSoup) -> List[Dict[str, Any]]:
        directors: List[Dict[str, Any]] = []
        for row in soup.find_all("tr"):
            cells = [_normalize_text(cell.get_text(" ")) for cell in row.find_all(["td", "th"])]
            joined = " ".join(cells)
            if not re.search(r"\b(DIN|Director|Signatory)\b", joined, re.IGNORECASE):
                continue
            if len(cells) >= 2 and not re.search(r"Name", cells[0], re.IGNORECASE):
                directors.append(
                    {
                        "name": cells[0],
                        "din": next((cell for cell in cells if re.fullmatch(r"\d{6,10}", cell)), None),
                        "designation": next(
                            (cell for cell in cells if re.search(r"director|signatory", cell, re.IGNORECASE)),
                            None,
                        ),
                    }
                )
        deduped: List[Dict[str, Any]] = []
        seen = set()
        for director in directors:
            key = (director.get("name") or "").lower()
            if key and key not in seen:
                deduped.append(director)
                seen.add(key)
        return deduped[:20]


mca_scraper = MCAScraper()
