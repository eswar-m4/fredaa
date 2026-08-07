"""Registry scraping orchestrator for official company registries."""

from __future__ import annotations

import asyncio
import re
from datetime import datetime
from typing import Any, Dict, Optional

from app.core.logger import setup_logger
from app.services.company_verification_service import normalize_workflow_record, resolve_company_identity
from app.services.registry_scrapers.companies_house_scraper import companies_house_scraper
from app.services.registry_scrapers.gleif_scraper import gleif_scraper
from app.services.registry_scrapers.mca_scraper import mca_scraper
from app.services.registry_scrapers.registry_capabilities import (
    REGISTRY_CAPABILITIES,
    REGISTRY_SOURCE_ALIASES,
    classify_registry_source_from_text,
    normalize_registry_source_name,
    registry_source_label,
)
from app.services.registry_scrapers.sec_scraper import sec_scraper
from app.services.registry_scrapers.wikidata_scraper import wikidata_scraper
from app.services.scrapers.website_scraper import _extract_domain

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
    normalized_text = re.sub(r"[^a-z0-9]+", "", text.lower())
    requested: set[str] = set()
    for key in REGISTRY_CAPABILITIES:
        if key in text or re.sub(r"[^a-z0-9]+", "", key.lower()) in normalized_text:
            requested.add(key)
    for alias, canonical in REGISTRY_SOURCE_ALIASES.items():
        if alias in normalized_text:
            requested.add(canonical)
    if "mca" in text or "india" in text:
        requested.add("mca_india")
    if "sec" in text or "edgar" in text:
        requested.add("sec_edgar")
    if "companies house" in text or "company house" in text or "uk" in text or "united kingdom" in text:
        requested.add("companies_house")
    if "gleif" in text or "lei" in text:
        requested.add("gleif")
    if "wikidata" in text or "knowledge graph" in text:
        requested.add("wikidata")
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

UK_COMPANY_HINTS = {
    "united kingdom",
    "great britain",
    "england",
    "scotland",
    "wales",
    "northern ireland",
    "uk",
    ".co.uk",
    "companies house",
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
    if country in {"united kingdom", "uk", "great britain", "gb", "britain"}:
        return "companies_house"

    if record.get("cin") or record.get("CIN"):
        return "mca_india"
    if record.get("cik") or record.get("CIK") or record.get("ticker") or record.get("symbol"):
        return "sec_edgar"
    if record.get("lei") or record.get("LEI") or record.get("lei_number"):
        return "gleif"

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
    if any(hint in text for hint in UK_COMPANY_HINTS):
        return "companies_house"
    if any(hint in text for hint in US_COMPANY_HINTS):
        return "sec_edgar"
    if "lei" in text or "legal entity identifier" in text:
        return "gleif"
    return None


def _has_strong_registry_identifier(record: Dict[str, Any]) -> bool:
    identifier_keys = (
        "lei",
        "LEI",
        "lei_number",
        "cik",
        "CIK",
        "ticker",
        "symbol",
        "cin",
        "CIN",
        "company_number",
        "company_no",
        "registration_number",
        "wikidata_qid",
        "qid",
    )
    return any(_clean(record.get(key)) for key in identifier_keys)


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
    return registry_source_label(registry_source)


def _is_empty_value(value: Any) -> bool:
    return value in (None, "", [], {})


def _canonical_registry_field(field: Any) -> str:
    key = str(field or "").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {
        "company_name": "company_name",
        "legal_name": "company_name",
        "entity_name": "company_name",
        "sec_company_name": "company_name",
        "name": "company_name",
        "website": "website",
        "website_url": "website",
        "company_website": "website",
        "homepage": "website",
        "homepage_url": "website",
        "url": "website",
        "domain": "website",
        "company_status": "company_status",
        "status": "company_status",
        "incorporation_date": "incorporation_date",
        "registration_date": "incorporation_date",
        "creation_date": "incorporation_date",
        "created_at": "incorporation_date",
        "hq_address": "hq_address",
        "registered_office_address": "hq_address",
        "business_address": "hq_address",
        "mailing_address": "hq_address",
        "legal_address": "hq_address",
        "hq_city": "hq_city",
        "city": "hq_city",
        "registered_city": "hq_city",
        "hq_state": "hq_state",
        "state": "hq_state",
        "region": "hq_state",
        "hq_country": "hq_country",
        "country": "hq_country",
        "jurisdiction": "hq_country",
        "industry": "industry",
        "sic_description": "industry",
        "business_activity": "industry",
        "sector": "industry",
        "legal_form": "legal_form",
        "company_type": "legal_form",
        "entity_type": "legal_form",
        "year_founded": "year_founded",
        "annual_revenue": "annual_revenue",
        "revenue": "annual_revenue",
        "employee_count": "employee_count",
        "employees": "employee_count",
        "parent_company": "parent_company",
        "ultimate_parent_company": "ultimate_parent_company",
        "subsidiaries": "subsidiaries",
        "description": "description",
    }
    return aliases.get(key, key)


def _ordered_capabilities(source_keys: list[str]) -> list[Any]:
    capabilities = [
        REGISTRY_CAPABILITIES[key]
        for key in source_keys
        if key in REGISTRY_CAPABILITIES
    ]
    return sorted(capabilities, key=lambda item: (-item.trust_weight, item.priority))


class RegistryOrchestrator:
    """
    Select and run official registry scrapers without changing website scraping.

    The orchestrator is conservative: registry lookups are best-effort and any
    timeout, anti-block response, or unsupported jurisdiction falls back to the
    existing website verification result.
    """

    def __init__(self, *, timeout_seconds: int = DEFAULT_REGISTRY_TIMEOUT_SECONDS) -> None:
        self.timeout_seconds = timeout_seconds
        self.adapters = {
            "sec_edgar": sec_scraper,
            "mca_india": mca_scraper,
            "gleif": gleif_scraper,
            "companies_house": companies_house_scraper,
            "wikidata": wikidata_scraper,
        }

    def _raw_company_name(
        self,
        record: Dict[str, Any],
        website_result: Optional[Dict[str, Any]],
    ) -> str:
        website_result = website_result or {}
        normalized_record = normalize_workflow_record(record)
        return _clean(
            normalized_record.get("company")
            or normalized_record.get("company_name")
            or normalized_record.get("name")
            or website_result.get("company")
            or ""
        )

    def _normalized_company_name(
        self,
        record: Dict[str, Any],
        website_result: Optional[Dict[str, Any]],
    ) -> str:
        normalized_record = normalize_workflow_record(record)
        normalized = resolve_company_identity(normalized_record)
        return normalized or self._raw_company_name(normalized_record, website_result)

    def _registry_sources_for_record(
        self,
        record: Dict[str, Any],
        *,
        config: Optional[Dict[str, Any]] = None,
        website_result: Optional[Dict[str, Any]] = None,
    ) -> list[str]:
        config = config or {}
        requested = _requested_registry_sources(config)
        if requested:
            ordered = _ordered_capabilities(list(requested))
            return [cap.source_key for cap in ordered]
        inferred = self.choose_registry(record, config=config, website_result=website_result)
        if inferred:
            if inferred == "gleif" and not _has_strong_registry_identifier(normalize_workflow_record(record)):
                return ["gleif", "wikidata"]
            return [inferred]
        normalized_record = normalize_workflow_record(record)
        company_name = self._raw_company_name(normalized_record, website_result)
        website_domain = _extract_domain(
            (website_result or {}).get("website")
            or (website_result or {}).get("selected_domain")
            or normalized_record.get("website")
            or ""
        )
        if company_name and not website_domain and not _has_strong_registry_identifier(normalized_record):
            return ["gleif", "wikidata"]
        return []

    async def _attempt_registry_source(
        self,
        source_key: str,
        record: Dict[str, Any],
        *,
        lookup_company_name: str,
        raw_company_name: str,
    ) -> Dict[str, Any]:
        adapter = self.adapters.get(source_key)
        if not adapter:
            return _normalized_fallback(
                registry_source=source_key,
                company_name=lookup_company_name or raw_company_name,
                reason="registry_not_implemented",
            )

        try:
            result = await asyncio.wait_for(
                adapter.lookup_company(
                    lookup_company_name or raw_company_name,
                    raw_company_name=raw_company_name,
                    normalized_company_name=lookup_company_name or raw_company_name,
                    cik=record.get("cik") or record.get("CIK"),
                    ticker=record.get("ticker") or record.get("symbol"),
                    lei=record.get("lei") or record.get("LEI") or record.get("lei_number"),
                    company_number=record.get("company_number") or record.get("company_no") or record.get("registration_number"),
                    qid=record.get("wikidata_qid") or record.get("qid"),
                ),
                timeout=self.timeout_seconds,
            )
        except Exception as exc:
            logger.warning("[Registry] %s failed for %s: %s", source_key, lookup_company_name or raw_company_name, exc)
            return _normalized_fallback(
                registry_source=source_key,
                company_name=lookup_company_name or raw_company_name,
                reason=str(exc),
            )

        raw_metadata = dict(result.get("raw_metadata") or {})
        raw_metadata.setdefault("normalized_company_name", lookup_company_name or raw_company_name)
        raw_metadata.setdefault("raw_company_name", raw_company_name)
        raw_metadata.setdefault("attempted_source", source_key)
        raw_metadata.setdefault("retrieved_at", datetime.utcnow().isoformat())

        enriched = dict(result)
        enriched["raw_metadata"] = raw_metadata
        enriched.setdefault("registry_source", source_key)
        return enriched

    def _merge_registry_attempts(
        self,
        attempts: list[Dict[str, Any]],
        *,
        lookup_company_name: str,
        raw_company_name: str,
        website_result: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        website_result = website_result or {}
        source_rows: list[Dict[str, Any]] = []
        for attempt in attempts:
            source_key = _clean(attempt.get("registry_source") or attempt.get("attempted_source")).lower()
            capability = REGISTRY_CAPABILITIES.get(source_key)
            source_rows.append(
                {
                    "source_key": source_key,
                    "source_label": _display_registry_source(source_key),
                    "capability": capability,
                    "registry_confidence": float(attempt.get("registry_confidence") or 0),
                    "status": (attempt.get("raw_metadata") or {}).get("status"),
                    "attempt": attempt,
                }
            )

        source_rows.sort(
            key=lambda item: (
                -(item["capability"].trust_weight if item["capability"] else 0.0),
                -item["registry_confidence"],
                item["capability"].priority if item["capability"] else 999,
                item["source_key"],
            )
        )

        merged_fields: Dict[str, Any] = {}
        source_contributions: list[Dict[str, Any]] = []
        successful_sources: list[str] = []

        for row in source_rows:
            attempt = row["attempt"]
            source_key = row["source_key"]
            raw_fields = dict(attempt.get("extracted_fields") or {})
            contributed_fields: list[str] = []
            for raw_field, raw_value in raw_fields.items():
                target_field = _canonical_registry_field(raw_field)
                if _is_empty_value(raw_value):
                    continue
                if _is_empty_value(merged_fields.get(target_field)):
                    merged_fields[target_field] = raw_value
                    contributed_fields.append(target_field)
            if source_key == "sec_edgar":
                entity_name = raw_fields.get("entity_name")
                if entity_name and _is_empty_value(merged_fields.get("sec_company_name")):
                    merged_fields["sec_company_name"] = entity_name
                profile = raw_fields.get("profile")
                if isinstance(profile, dict):
                    entity_type = profile.get("entity_type")
                    if entity_type and _is_empty_value(merged_fields.get("sec_entity_type")):
                        merged_fields["sec_entity_type"] = entity_type
            if row["status"] == "success":
                successful_sources.append(source_key)
            source_contributions.append(
                {
                    "source_key": source_key,
                    "source_label": row["source_label"],
                    "registry_confidence": row["registry_confidence"],
                    "status": row["status"],
                    "contributed_fields": contributed_fields,
                    "normalized_company_name": lookup_company_name,
                    "raw_company_name": raw_company_name,
                }
            )

        primary_source = next(
            (row for row in source_rows if row["status"] == "success"),
            source_rows[0] if source_rows else {},
        )
        primary_attempt = primary_source.get("attempt") or {}
        primary_source_key = primary_source.get("source_key") or primary_attempt.get("registry_source") or "registry"
        primary_confidence = float(primary_attempt.get("registry_confidence") or 0)
        primary_source_type = primary_attempt.get("source_type") or "government_registry"

        merged_raw_metadata = dict(primary_attempt.get("raw_metadata") or {})
        merged_raw_metadata.update(
            {
                "status": "success" if successful_sources else "no_match",
                "reason": None if successful_sources else "no_registry_matches",
                "company_name": lookup_company_name or raw_company_name,
                "normalized_company_name": lookup_company_name,
                "raw_company_name": raw_company_name,
                "retrieved_at": datetime.utcnow().isoformat(),
                "website_fallback": {
                    "website": website_result.get("website"),
                    "confidence": website_result.get("confidence"),
                    "scraped_metadata": website_result.get("scraped_metadata") or {},
                },
                "source_results": source_contributions,
                "attempted_sources": [row["source_key"] for row in source_rows],
                "successful_sources": successful_sources,
            }
        )

        return {
            "source_type": primary_source_type,
            "registry_source": primary_source_key,
            "registry_confidence": primary_confidence,
            "extracted_fields": merged_fields,
            "raw_metadata": merged_raw_metadata,
            "registry_sources": [row["source_key"] for row in source_rows],
            "source_results": source_contributions,
            "merge_strategy": "fan_out",
            "normalized_company_name": lookup_company_name,
            "raw_company_name": raw_company_name,
        }

    async def enrich_record(
        self,
        record: Dict[str, Any],
        *,
        website_result: Optional[Dict[str, Any]] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        config = config or {}
        normalized_record = normalize_workflow_record(record)
        raw_company_name = self._raw_company_name(normalized_record, website_result)
        lookup_company_name = self._normalized_company_name(normalized_record, website_result)
        registry_sources = self._registry_sources_for_record(
            normalized_record,
            config=config,
            website_result=website_result,
        )
        logger.info(
            "[Registry] orchestrator invoked raw_company=%s lookup_company=%s sources=%s",
            raw_company_name or "Unknown",
            lookup_company_name or "Unknown",
            registry_sources or ["none"],
        )

        if not registry_sources:
            logger.info(
                "[Registry] skipped company=%s reason=registry_not_selected",
                lookup_company_name or raw_company_name or "Unknown",
            )
            return _normalized_fallback(
                registry_source="unsupported",
                company_name=lookup_company_name or raw_company_name,
                reason="registry_not_selected",
                website_result=website_result,
            )

        attempts = await asyncio.gather(
            *[
                self._attempt_registry_source(
                    source_key,
                    normalized_record,
                    lookup_company_name=lookup_company_name,
                    raw_company_name=raw_company_name,
                )
                for source_key in registry_sources
            ]
        )
        merged = self._merge_registry_attempts(
            attempts,
            lookup_company_name=lookup_company_name,
            raw_company_name=raw_company_name,
            website_result=website_result,
        )
        logger.info(
            "[Registry] merged company=%s sources=%s primary=%s confidence=%s fields=%s",
            lookup_company_name or raw_company_name or "Unknown",
            merged.get("registry_sources") or [],
            merged.get("registry_source"),
            merged.get("registry_confidence"),
            sorted((merged.get("extracted_fields") or {}).keys()),
        )
        return merged

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
            "registry_sources": registry_result.get("registry_sources") or [],
            "source_results": registry_result.get("source_results") or [],
            "merge_strategy": registry_result.get("merge_strategy") or "legacy",
            "normalized_company_name": registry_result.get("normalized_company_name"),
            "raw_company_name": registry_result.get("raw_company_name"),
        }
        merged["registry_metadata"] = registry_metadata
        provenance = dict(merged.get("_field_provenance") or merged.get("field_provenance") or {})
        for source_result in registry_metadata.get("source_results") or []:
            source_key = source_result.get("source_key") or registry_metadata.get("registry_source") or "registry"
            source_label = source_result.get("source_label") or _display_registry_source(source_key)
            for field in source_result.get("contributed_fields") or []:
                field_name = str(field or "").strip()
                if not field_name:
                    continue
                provenance.setdefault(
                    field_name,
                    {
                        "source": source_key,
                        "source_label": source_label,
                        "source_type": registry_metadata.get("source_type") or "government_registry",
                        "source_url": (registry_metadata.get("raw_metadata") or {}).get("company_browse_url") or "",
                    },
                )
        if provenance:
            merged["_field_provenance"] = provenance
            merged["field_provenance"] = provenance
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
        normalized_explicit = normalize_registry_source_name(explicit)
        if normalized_explicit in self.adapters:
            return normalized_explicit

        requested = _requested_registry_sources(config)
        regional_hint = _country_registry_hint(record, company_name, website_result)
        if regional_hint and (not requested or regional_hint in requested):
            return regional_hint
        if _has_strong_registry_identifier(record):
            if _clean(record.get("lei") or record.get("LEI") or record.get("lei_number")):
                return "gleif"
            if _clean(record.get("cik") or record.get("CIK") or record.get("ticker") or record.get("symbol")):
                return "sec_edgar"
            if _clean(record.get("cin") or record.get("CIN")):
                return "mca_india"
            if _clean(record.get("company_number") or record.get("company_no") or record.get("registration_number")):
                return "companies_house"
        if len(requested) == 1:
            requested_source = next(iter(requested))
            if requested_source in self.adapters:
                return requested_source
        if len(requested) > 1:
            if regional_hint and regional_hint in requested:
                return regional_hint
            ordered = sorted(
                (REGISTRY_CAPABILITIES.get(src) for src in requested if REGISTRY_CAPABILITIES.get(src)),
                key=lambda item: item.priority,
            )
            if ordered:
                return ordered[0].source_key
        website_domain = _extract_domain((website_result or {}).get("website") or (website_result or {}).get("selected_domain") or record.get("website") or "")
        if website_domain.endswith(".co.uk") or website_domain.endswith(".uk"):
            return "companies_house"
        if website_domain.endswith(".in"):
            return "mca_india"
        if website_domain and any(hint in website_domain for hint in ("sec", "investor", "ir.", "investors", "edgar", "filings")):
            return "sec_edgar"
        if company_name and website_domain:
            if any(hint in website_domain for hint in ("official", "corporate", "company", "investor", "relations")):
                return "gleif"
            if any(hint in company_name.lower() for hint in ("inc", "corp", "corporation", "company", "limited", "ltd", "plc")):
                return "gleif"
            return "wikidata"
        if company_name:
            if any(hint in company_name.lower() for hint in ("inc", "corp", "corporation", "company", "limited", "ltd", "plc")):
                return "gleif"
            return "gleif"
        inferred = classify_registry_source_from_text(_source_text(config))
        if inferred in self.adapters:
            return inferred
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
