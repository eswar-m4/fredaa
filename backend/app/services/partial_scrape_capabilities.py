"""
Capability registry for Partial Scrape planning.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass(frozen=True)
class PartialScrapeCapability:
    source_key: str
    source_name: str
    adapter_kind: str
    supported_fields: List[str]
    aliases: List[str] = field(default_factory=list)
    supports_url_hints: bool = False
    supports_keywords: bool = True
    supports_date_ranges: bool = False
    supports_file_types: bool = False
    supports_crawl_limits: bool = False
    notes: str = ""


_REGISTRY: Dict[str, PartialScrapeCapability] = {
    "keysight": PartialScrapeCapability(
        source_key="keysight",
        source_name="Keysight",
        adapter_kind="field_filter",
        supported_fields=["category", "product_family", "product_series", "region", "sku"],
        aliases=["keysight", "keysight.com"],
        supports_url_hints=False,
        supports_keywords=True,
        supports_date_ranges=False,
        supports_file_types=False,
        supports_crawl_limits=False,
        notes="Product catalog filters map to exact product facets.",
    ),
    "webmd": PartialScrapeCapability(
        source_key="webmd",
        source_name="Webmd",
        adapter_kind="field_filter",
        supported_fields=[
            "specialty",
            "state",
            "city",
            "hospital_affiliations",
            "languages_spoken",
            "medical_school",
            "accepting_new_patients",
            "medicare_accepted",
            "medicaid_accepted",
        ],
        aliases=["webmd", "webmd.com"],
        supports_url_hints=False,
        supports_keywords=True,
        supports_date_ranges=False,
        supports_file_types=False,
        supports_crawl_limits=False,
        notes="Physician profile filters map to profile attributes.",
    ),
    "investegate": PartialScrapeCapability(
        source_key="investegate",
        source_name="Investegate",
        adapter_kind="field_filter",
        supported_fields=[
            "ticker",
            "cik",
            "state_of_incorporation",
            "sic_description",
            "filing_type",
            "fiscal_year_end",
            "entity_name",
        ],
        aliases=["investegate", "investegate.co.uk"],
        supports_url_hints=True,
        supports_keywords=True,
        supports_date_ranges=True,
        supports_file_types=False,
        supports_crawl_limits=False,
        notes="Financial filing filters map to security and filing attributes.",
    ),
    "turkeybrokers": PartialScrapeCapability(
        source_key="turkeybrokers",
        source_name="TurkeyBrokers",
        adapter_kind="field_filter",
        supported_fields=["city", "address", "primarykey"],
        aliases=["turkeybrokers", "turkey brokers"],
        supports_url_hints=False,
        supports_keywords=True,
        supports_date_ranges=False,
        supports_file_types=False,
        supports_crawl_limits=False,
        notes="Broker listings filter by city, address, or primary key.",
    ),
}


_FIELD_ALIASES: Dict[str, Dict[str, str]] = {
    "keysight": {
        "category": "category",
        "product_category": "category",
        "family": "product_family",
        "product_family": "product_family",
        "series": "product_series",
        "product_series": "product_series",
        "region": "region",
        "locale": "region",
        "sku": "sku",
        "model": "sku",
    },
    "webmd": {
        "specialty": "specialty",
        "state": "state",
        "city": "city",
        "hospital": "hospital_affiliations",
        "hospital_affiliations": "hospital_affiliations",
        "languages": "languages_spoken",
        "languages_spoken": "languages_spoken",
        "medical_school": "medical_school",
        "accepting_new_patients": "accepting_new_patients",
        "medicare_accepted": "medicare_accepted",
        "medicaid_accepted": "medicaid_accepted",
    },
    "investegate": {
        "ticker": "ticker",
        "cik": "cik",
        "state": "state_of_incorporation",
        "state_of_incorporation": "state_of_incorporation",
        "sic": "sic_description",
        "sic_description": "sic_description",
        "filing_type": "filing_type",
        "fiscal_year_end": "fiscal_year_end",
        "entity_name": "entity_name",
        "company_name": "entity_name",
    },
    "turkeybrokers": {
        "city": "city",
        "address": "address",
        "primarykey": "primarykey",
        "broker": "primarykey",
        "name": "primarykey",
    },
}


def normalize_source_key(source: str) -> str:
    text = (source or "").strip().lower()
    for key, capability in _REGISTRY.items():
        if text == key or text == capability.source_name.lower() or text in {alias.lower() for alias in capability.aliases}:
            return key
    return text.replace(" ", "").replace("-", "").replace("_", "")


def get_partial_scrape_capability(source: str) -> Optional[PartialScrapeCapability]:
    key = normalize_source_key(source)
    return _REGISTRY.get(key)


def all_partial_scrape_capabilities() -> List[PartialScrapeCapability]:
    return list(_REGISTRY.values())


def canonicalize_field(source_key: str, field_name: str) -> Optional[str]:
    key = normalize_source_key(source_key)
    aliases = _FIELD_ALIASES.get(key, {})
    normalized = (field_name or "").strip().lower().replace(" ", "_")
    if normalized in aliases:
        return aliases[normalized]
    if normalized in aliases.values():
        return normalized
    return None


def field_alias_map(source_key: str) -> Dict[str, str]:
    return dict(_FIELD_ALIASES.get(normalize_source_key(source_key), {}))
