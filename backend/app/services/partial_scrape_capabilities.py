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


_REGISTRY: Dict[str, PartialScrapeCapability] = {}


_FIELD_ALIASES: Dict[str, Dict[str, str]] = {}


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
