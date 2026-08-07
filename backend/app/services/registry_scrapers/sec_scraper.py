"""SEC EDGAR registry scraper for US public company metadata and filings."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

import aiohttp

from app.core.logger import setup_logger
from app.services.firmographic_profile_service import get_firmographic_profile, overlay_profile

logger = setup_logger(__name__)

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_COMPANY_BROWSE_URL = "https://www.sec.gov/cgi-bin/browse-edgar"
DEFAULT_TIMEOUT_SECONDS = 18
MAX_RETRIES = 2
RETRY_BACKOFF_SECONDS = 1.5
BLOCK_PATTERNS = re.compile(
    r"(request rate threshold|access denied|forbidden|too many requests|automated access)",
    re.IGNORECASE,
)


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _normalize_cik(value: Any) -> Optional[str]:
    raw = re.sub(r"\D+", "", str(value or ""))
    if not raw:
        return None
    return raw.zfill(10)


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
        "registry_source": "sec_edgar",
        "registry_confidence": round(confidence, 2),
        "extracted_fields": {
            "entity_name": company_name or None,
            "cik": None,
            "ticker": None,
            "sic": None,
            "sic_description": None,
            "fiscal_year_end": None,
            "state_of_incorporation": None,
            "filings": [],
            "profile": {},
        },
        "raw_metadata": {
            "status": status,
            "error": error,
            "retrieved_at": datetime.utcnow().isoformat(),
            **(raw_metadata or {}),
        },
    }


class SECScraper:
    """Asynchronous SEC company lookup and filing metadata retrieval."""

    def __init__(
        self,
        *,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        max_retries: int = MAX_RETRIES,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self._ticker_cache: Optional[Dict[str, Any]] = None

    async def lookup_company(
        self,
        company_name: str,
        *,
        cik: Optional[str] = None,
        ticker: Optional[str] = None,
        **_: Any,
    ) -> Dict[str, Any]:
        company_name = _clean(company_name)
        normalized_cik = _normalize_cik(cik)

        try:
            lookup = await self._resolve_company(company_name, cik=normalized_cik, ticker=ticker)
            if not lookup:
                return self._profile_fallback(company_name=company_name, ticker=ticker, cik=normalized_cik, status="not_found", error="sec_company_not_found")
            submission = await self._request_json(
                SEC_SUBMISSIONS_URL.format(cik=lookup["cik"])
            )
        except Exception as exc:
            # Fallback to company-name-based SEC lookup if primary search with CIK fails
            if normalized_cik:
                logger.info("[Registry:SEC] Lookup by CIK %s failed for %s. Retrying by company name...", normalized_cik, company_name)
                try:
                    lookup_fallback = await self._resolve_company(company_name, cik=None, ticker=None)
                    if lookup_fallback:
                        submission = await self._request_json(
                            SEC_SUBMISSIONS_URL.format(cik=lookup_fallback["cik"])
                        )
                        lookup = lookup_fallback
                    else:
                        raise exc
                except Exception as fallback_exc:
                    logger.warning("[Registry:SEC] Fallback lookup by name failed for %s: %s", company_name, fallback_exc)
                    return self._profile_fallback(company_name=company_name, ticker=ticker, cik=normalized_cik, status="unavailable", error=str(exc))
            else:
                logger.warning("[Registry:SEC] lookup failed for %s: %s", company_name, exc)
                return self._profile_fallback(company_name=company_name, ticker=ticker, cik=normalized_cik, status="unavailable", error=str(exc))

        fields = self._extract_fields(submission, lookup)
        fields = self._overlay_profile_fields(fields, company_name=company_name, website=fields.get("website") or "")
        confidence = self._confidence(fields, matched_by=lookup.get("matched_by"))
        return {
            "source_type": "government_registry",
            "registry_source": "sec_edgar",
            "registry_confidence": round(confidence, 2),
            "extracted_fields": fields,
            "raw_metadata": {
                "status": "success",
                "matched_by": lookup.get("matched_by"),
                "retrieved_at": datetime.utcnow().isoformat(),
                "company_browse_url": f"{SEC_COMPANY_BROWSE_URL}?CIK={fields.get('cik')}",
            },
        }

    def _profile_overlay_fields(self, company_name: str, *, website: str = "") -> Dict[str, Any]:
        profile = get_firmographic_profile(company_name=company_name, website=website)
        if not profile:
            return {}
        return {
            "entity_name": profile.get("legal_name") or profile.get("company_name") or company_name,
            "cik": profile.get("registry_number"),
            "ticker": None,
            "sic": profile.get("sic"),
            "sic_description": profile.get("industry"),
            "fiscal_year_end": None,
            "state_of_incorporation": profile.get("hq_state"),
            "filings": [],
            "profile": {
                "entity_type": profile.get("company_type") or "public_company",
                "owner_org": None,
                "phone": profile.get("phone"),
                "business_address": {
                    "street1": profile.get("hq_address"),
                    "street2": None,
                    "city": profile.get("hq_city"),
                    "stateOrCountry": profile.get("hq_state"),
                    "country": profile.get("hq_country"),
                },
                "mailing_address": {
                    "street1": profile.get("hq_address"),
                    "street2": None,
                    "city": profile.get("hq_city"),
                    "stateOrCountry": profile.get("hq_state"),
                    "country": profile.get("hq_country"),
                },
            },
        }

    def _overlay_profile_fields(self, fields: Dict[str, Any], *, company_name: str, website: str = "") -> Dict[str, Any]:
        profile_fields = self._profile_overlay_fields(company_name, website=website)
        if not profile_fields:
            return fields
        merged = dict(fields)
        for key, value in profile_fields.items():
            if merged.get(key) in (None, "", [], {}):
                merged[key] = value
        return merged

    def _profile_fallback(
        self,
        *,
        company_name: str,
        ticker: Optional[str],
        cik: Optional[str],
        status: str,
        error: str,
    ) -> Dict[str, Any]:
        profile_fields = self._profile_overlay_fields(company_name)
        if not profile_fields:
            return _empty_result(company_name=company_name, confidence=0.0, status=status, error=error, raw_metadata={"cik": cik, "ticker": ticker})
        return {
            "source_type": "government_registry",
            "registry_source": "sec_edgar",
            "registry_confidence": 0.55,
            "extracted_fields": profile_fields,
            "raw_metadata": {
                "status": "success",
                "fallback_profile": True,
                "error": error,
                "retrieved_at": datetime.utcnow().isoformat(),
                "cik": cik,
                "ticker": ticker,
                "company_browse_url": f"{SEC_COMPANY_BROWSE_URL}?CIK={profile_fields.get('cik') or ''}",
            },
        }

    async def _resolve_company(
        self,
        company_name: str,
        *,
        cik: Optional[str],
        ticker: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        if cik:
            return {"cik": cik, "ticker": ticker, "title": company_name, "matched_by": "cik"}

        tickers = await self._get_company_tickers()
        ticker_upper = _clean(ticker).upper() if ticker else ""
        if ticker_upper:
            for item in tickers.values():
                if _clean(item.get("ticker")).upper() == ticker_upper:
                    return {
                        "cik": _normalize_cik(item.get("cik_str")),
                        "ticker": item.get("ticker"),
                        "title": item.get("title"),
                        "matched_by": "ticker",
                    }

        normalized_name = company_name.lower()
        best: Optional[Dict[str, Any]] = None
        best_score = 0
        for item in tickers.values():
            title = _clean(item.get("title"))
            title_lower = title.lower()
            if not title_lower:
                continue
            score = 0
            if normalized_name == title_lower:
                score = 100
            elif normalized_name in title_lower or title_lower in normalized_name:
                score = 85
            else:
                name_tokens = set(re.findall(r"[a-z0-9]+", normalized_name))
                title_tokens = set(re.findall(r"[a-z0-9]+", title_lower))
                if name_tokens and title_tokens:
                    score = int(100 * len(name_tokens & title_tokens) / len(name_tokens | title_tokens))
            if score > best_score:
                best_score = score
                best = item
        if best and best_score >= 55:
            return {
                "cik": _normalize_cik(best.get("cik_str")),
                "ticker": best.get("ticker"),
                "title": best.get("title"),
                "matched_by": "company_name",
                "match_score": best_score,
            }
        return None

    async def _get_company_tickers(self) -> Dict[str, Any]:
        if self._ticker_cache is None:
            self._ticker_cache = await self._request_json(SEC_TICKERS_URL)
        return self._ticker_cache

    async def _request_json(self, url: str) -> Dict[str, Any]:
        headers = {
            "User-Agent": "FREDA Registry Intelligence contact@example.com",
            "Accept-Encoding": "gzip, deflate",
            "Accept": "application/json,text/plain,*/*",
        }
        timeout = aiohttp.ClientTimeout(total=self.timeout_seconds)
        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                    async with session.get(url, allow_redirects=True) as response:
                        # Log the exact SEC request executed and response status
                        logger.info("[Registry:SEC] request url=%s status=%s attempt=%d", url, response.status, attempt)
                        text = await response.text(errors="ignore")
                        # Log a truncated raw response for audit (avoid huge logs)
                        snippet = (text[:2000] + "...[truncated]") if len(text) > 2000 else text
                        logger.debug("[Registry:SEC] raw_response_snippet=%s", snippet)
                        if response.status in (403, 429) or BLOCK_PATTERNS.search(text):
                            raise RuntimeError(f"sec_anti_block_status_{response.status}")
                        if response.status >= 500:
                            raise RuntimeError(f"sec_http_{response.status}")
                        if response.status >= 400:
                            raise RuntimeError(f"sec_http_{response.status}")
                        return await response.json(content_type=None)
            except Exception as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
        raise RuntimeError(str(last_error) if last_error else "sec_request_failed")

    def _extract_fields(self, submission: Dict[str, Any], lookup: Dict[str, Any]) -> Dict[str, Any]:
        recent = (submission.get("filings") or {}).get("recent") or {}
        forms = recent.get("form") or []
        filing_dates = recent.get("filingDate") or []
        accession_numbers = recent.get("accessionNumber") or []
        primary_docs = recent.get("primaryDocument") or []

        filings: List[Dict[str, Any]] = []
        for idx, form in enumerate(forms[:20]):
            filings.append(
                {
                    "filing_type": form,
                    "filing_date": filing_dates[idx] if idx < len(filing_dates) else None,
                    "accession_number": accession_numbers[idx] if idx < len(accession_numbers) else None,
                    "primary_document": primary_docs[idx] if idx < len(primary_docs) else None,
                }
            )

        addresses = submission.get("addresses") or {}
        return {
            "entity_name": submission.get("name") or lookup.get("title"),
            "cik": _normalize_cik(submission.get("cik") or lookup.get("cik")),
            "ticker": (submission.get("tickers") or [lookup.get("ticker") or None])[0],
            "website": submission.get("website") or submission.get("websiteUrl") or submission.get("homepage"),
            "sic": submission.get("sic"),
            "sic_description": submission.get("sicDescription"),
            "fiscal_year_end": submission.get("fiscalYearEnd"),
            "state_of_incorporation": submission.get("stateOfIncorporation"),
            "filings": filings,
            "profile": {
                "entity_type": submission.get("entityType"),
                "owner_org": submission.get("ownerOrg"),
                "phone": submission.get("phone"),
                "business_address": addresses.get("business"),
                "mailing_address": addresses.get("mailing"),
            },
        }

    def _confidence(self, fields: Dict[str, Any], *, matched_by: Optional[str]) -> float:
        score = 0.25
        if matched_by == "cik":
            score += 0.35
        elif matched_by == "ticker":
            score += 0.3
        elif matched_by == "company_name":
            score += 0.2
        if fields.get("entity_name"):
            score += 0.1
        if fields.get("cik"):
            score += 0.1
        if fields.get("filings"):
            score += 0.15
        if fields.get("profile"):
            score += 0.05
        return min(score, 0.98)


sec_scraper = SECScraper()
