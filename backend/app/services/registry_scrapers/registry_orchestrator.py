"""Registry scraping orchestrator for official company registries."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime
from typing import Any, Dict, Optional

from app.core.logger import setup_logger
from app.services.registry_scrapers.mca_scraper import mca_scraper
from app.services.registry_scrapers.sec_scraper import sec_scraper

logger = setup_logger(__name__)

DEFAULT_REGISTRY_TIMEOUT_SECONDS = 22


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _source_text(config: Dict[str, Any]) -> str:
    values: list[Any] = []
    for key in (
        "prioritySources",
        "enrichmentSources",
        "selectedEnrichmentSources",
        "sources",
        "workflowTypes",
        "selectedWorkflows",
        "sourceConfiguration",
    ):
        value = config.get(key)
        if isinstance(value, dict):
            values.extend(value.keys())
            values.extend(value.values())
        elif isinstance(value, list):
            values.extend(value)
        elif value:
            values.append(value)
    return " ".join(str(item) for item in values).lower()


def _requested_registry_sources(config: Dict[str, Any]) -> set[str]:
    text = _source_text(config)
    requested: set[str] = set()
    if "mca" in text or "india" in text:
        requested.add("mca_india")
    if "sec" in text or "edgar" in text:
        requested.add("sec_edgar")
    return requested


INDIAN_COMPANY_HINTS = {
    "infosys",
    "reliance",
    "reliance industries",
    "tcs",
    "tata consultancy",
    "wipro",
    "hcl",
    "hdfc",
    "icici",
    "axis bank",
    "bharat",
    "mahindra",
    "adani",
    "larsen",
}

US_COMPANY_HINTS = {
    "microsoft",
    "tesla",
    "apple",
    "oracle",
    "nvidia",
    "salesforce",
    "adobe",
    "ibm",
    "hubspot",
    "amazon",
    "alphabet",
    "google",
    "meta",
    "netflix",
}


def _country_registry_hint(record: Dict[str, Any], company_name: str, website_result: Optional[Dict[str, Any]]) -> Optional[str]:
    website_result = website_result or {}
    country = _clean(
        record.get("country")
        or record.get("jurisdiction")
        or record.get("region")
        or record.get("location")
    ).lower()
    if country in {"india", "in", "ind"}:
        return "mca_india"
    if country in {"united states", "usa", "us", "u.s.", "u.s.a.", "america"}:
        return "sec_edgar"

    if record.get("cin") or record.get("CIN"):
        return "mca_india"
    if record.get("cik") or record.get("CIK") or record.get("ticker") or record.get("symbol"):
        return "sec_edgar"

    text = " ".join(
        [
            company_name,
            _clean(record.get("company") or record.get("company_name") or ""),
            _clean((website_result.get("selected_domain") or "")),
            _clean((website_result.get("website") or "")),
            _clean(((website_result.get("scraped_metadata") or {}).get("meta_description") or "")),
        ]
    ).lower()
    if ".in" in text or any(hint in text for hint in INDIAN_COMPANY_HINTS):
        return "mca_india"
    if any(hint in text for hint in US_COMPANY_HINTS):
        return "sec_edgar"
    return None


def _normalized_fallback(
    *,
    registry_source: str,
    company_name: str,
    reason: str,
    website_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    website_result = website_result or {}
    return {
        "source_type": "government_registry",
        "registry_source": registry_source,
        "registry_confidence": 0.0,
        "extracted_fields": {},
        "raw_metadata": {
            "status": "fallback_to_website",
            "reason": reason,
            "company_name": company_name,
            "retrieved_at": datetime.utcnow().isoformat(),
            "website_fallback": {
                "website": website_result.get("website"),
                "confidence": website_result.get("confidence"),
                "scraped_metadata": website_result.get("scraped_metadata") or {},
            },
        },
    }


def _display_registry_source(registry_source: str) -> str:
    if registry_source == "sec_edgar":
        return "SEC EDGAR"
    if registry_source == "mca_india":
        return "MCA Registry"
    return registry_source or "Registry"


class RegistryOrchestrator:
    """
    Select and run official registry scrapers without changing website scraping.

    The orchestrator is conservative: registry lookups are best-effort and any
    timeout, anti-block response, or unsupported jurisdiction falls back to the
    existing website verification result.
    """

    def __init__(self, *, timeout_seconds: int = DEFAULT_REGISTRY_TIMEOUT_SECONDS) -> None:
        self.timeout_seconds = timeout_seconds

    async def enrich_record(
        self,
        record: Dict[str, Any],
        *,
        website_result: Optional[Dict[str, Any]] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        config = config or {}
        company_name = self._company_name(record, website_result)
        registry_source = self.choose_registry(record, config=config, website_result=website_result)
        logger.info(
            "[Registry] orchestrator invoked company=%s selected_registry=%s",
            company_name or "Unknown",
            registry_source or "none",
        )

        if not registry_source:
            logger.info(
                "[Registry] skipped company=%s reason=registry_not_selected",
                company_name or "Unknown",
            )
            return _normalized_fallback(
                registry_source="unsupported",
                company_name=company_name,
                reason="registry_not_selected",
                website_result=website_result,
            )

        try:
            if registry_source == "mca_india":
                result = await asyncio.wait_for(
                    mca_scraper.lookup_company(company_name),
                    timeout=self.timeout_seconds,
                )
            elif registry_source == "sec_edgar":
                result = await asyncio.wait_for(
                    sec_scraper.lookup_company(
                        company_name,
                        cik=record.get("cik") or record.get("CIK"),
                        ticker=record.get("ticker") or record.get("symbol"),
                    ),
                    timeout=self.timeout_seconds,
                )
            else:
                return _normalized_fallback(
                    registry_source=registry_source,
                    company_name=company_name,
                    reason="registry_not_implemented",
                    website_result=website_result,
                )
        except Exception as exc:
            logger.warning("[Registry] %s failed for %s: %s", registry_source, company_name, exc)
            return _normalized_fallback(
                registry_source=registry_source,
                company_name=company_name,
                reason=str(exc),
                website_result=website_result,
            )

        logger.info(
            "[Registry] scraper response company=%s registry=%s confidence=%s status=%s",
            company_name or "Unknown",
            result.get("registry_source"),
            result.get("registry_confidence"),
            (result.get("raw_metadata") or {}).get("status"),
        )
        if (result.get("registry_confidence") or 0) <= 0:
            result.setdefault("raw_metadata", {})["website_fallback"] = {
                "website": (website_result or {}).get("website"),
                "confidence": (website_result or {}).get("confidence"),
            }
        return result

    async def enrich_many(
        self,
        records: list[Dict[str, Any]],
        *,
        website_results: Optional[list[Dict[str, Any]]] = None,
        config: Optional[Dict[str, Any]] = None,
        concurrency: int = 3,
    ) -> list[Dict[str, Any]]:
        semaphore = asyncio.Semaphore(max(1, min(concurrency, 5)))
        website_results = website_results or [{} for _ in records]

        async def run_one(index: int, record: Dict[str, Any]) -> Dict[str, Any]:
            async with semaphore:
                return await self.enrich_record(
                    record,
                    website_result=website_results[index] if index < len(website_results) else {},
                    config=config,
                )

        return await asyncio.gather(*[run_one(idx, record) for idx, record in enumerate(records)])

    def merge_into_workflow_output(
        self,
        workflow_item: Dict[str, Any],
        registry_result: Dict[str, Any],
    ) -> Dict[str, Any]:
        merged = dict(workflow_item)
        registry_metadata = {
            "source_type": registry_result.get("source_type"),
            "registry_source": registry_result.get("registry_source"),
            "registry_confidence": registry_result.get("registry_confidence"),
            "extracted_fields": registry_result.get("extracted_fields") or {},
            "raw_metadata": registry_result.get("raw_metadata") or {},
        }
        merged["registry_metadata"] = registry_metadata
        logger.info(
            "[Registry] attached metadata company=%s registry=%s confidence=%s",
            merged.get("company") or (merged.get("original_data") or {}).get("company") or "Unknown",
            registry_metadata.get("registry_source"),
            registry_metadata.get("registry_confidence"),
        )
        merged.setdefault("matches", [])
        source_label = _display_registry_source(registry_metadata["registry_source"])
        merged["matches"].append(
            {
                "source": source_label,
                "source_key": registry_metadata["registry_source"],
                "source_type": registry_metadata["source_type"],
                "confidence": registry_metadata["registry_confidence"],
                "verified": (registry_metadata["registry_confidence"] or 0) >= 0.7,
                "matched_fields": list((registry_metadata["extracted_fields"] or {}).keys()),
                "extracted_values": registry_metadata["extracted_fields"],
                "snippet": "Official registry metadata",
            }
        )
        return merged

    def choose_registry(
        self,
        record: Dict[str, Any],
        *,
        config: Optional[Dict[str, Any]] = None,
        website_result: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        config = config or {}
        company_name = self._company_name(record, website_result)
        explicit = _clean(
            config.get("registrySource")
            or config.get("registry_source")
            or record.get("registry_source")
            or record.get("registry")
        ).lower()
        if explicit in {"mca", "mca_india", "india", "in"}:
            return "mca_india"
        if explicit in {"sec", "sec_edgar", "edgar", "us", "usa"}:
            return "sec_edgar"

        requested = _requested_registry_sources(config)
        regional_hint = _country_registry_hint(record, company_name, website_result)
        if regional_hint and (not requested or regional_hint in requested):
            return regional_hint
        if len(requested) == 1:
            return next(iter(requested))
        if len(requested) > 1:
            return regional_hint or "sec_edgar"
        return None

    def _company_name(
        self,
        record: Dict[str, Any],
        website_result: Optional[Dict[str, Any]],
    ) -> str:
        website_result = website_result or {}
        return _clean(
            record.get("company")
            or record.get("company_name")
            or record.get("name")
            or website_result.get("company")
            or ""
        )


registry_orchestrator = RegistryOrchestrator()
