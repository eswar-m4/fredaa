"""Capability registry for official and public knowledge registry sources."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple


@dataclass(frozen=True)
class RegistryCapability:
    source_key: str
    label: str
    source_type: str
    adapter_kind: str
    keywords: Tuple[str, ...]
    jurisdiction_hints: Tuple[str, ...]
    supported_fields: Tuple[str, ...]
    trust_weight: float
    priority: int

    def matches_text(self, text: str) -> bool:
        haystack = (text or "").lower()
        return any(keyword in haystack for keyword in self.keywords)


REGISTRY_SOURCE_ALIASES: Dict[str, str] = {
    "sec": "sec_edgar",
    "secedgar": "sec_edgar",
    "edgar": "sec_edgar",
    "mca": "mca_india",
    "mcaindia": "mca_india",
    "india": "mca_india",
    "gleif": "gleif",
    "lei": "gleif",
    "gleifenrichment": "gleif",
    "leisearch": "gleif",
    "globallei": "gleif",
    "companieshouse": "companies_house",
    "companyhouse": "companies_house",
    "companieshouseenrichment": "companies_house",
    "ukcompanieshouse": "companies_house",
    "wikidata": "wikidata",
    "wiki": "wikidata",
    "wikidataenrichment": "wikidata",
    "knowledgegraph": "wikidata",
}


REGISTRY_CAPABILITIES: Dict[str, RegistryCapability] = {
    "sec_edgar": RegistryCapability(
        source_key="sec_edgar",
        label="SEC EDGAR",
        source_type="government_registry",
        adapter_kind="official_registry",
        keywords=("sec", "edgar", "sec.gov", "10-k", "ticker", "cik"),
        jurisdiction_hints=("us", "usa", "united states"),
        supported_fields=("company_name", "website", "industry", "cik", "ticker", "hq_address", "hq_country", "company_status"),
        trust_weight=0.95,
        priority=1,
    ),
    "mca_india": RegistryCapability(
        source_key="mca_india",
        label="MCA Registry",
        source_type="government_registry",
        adapter_kind="official_registry",
        keywords=("mca", "india", "cin", "roc", "companies act"),
        jurisdiction_hints=("india", "in"),
        supported_fields=("company_name", "company_status", "incorporation_date", "cin", "hq_address", "directors", "legal_form"),
        trust_weight=0.92,
        priority=2,
    ),
    "companies_house": RegistryCapability(
        source_key="companies_house",
        label="Companies House",
        source_type="government_registry",
        adapter_kind="official_registry",
        keywords=("companies house", "company house", "gov.uk/company", "registered office", "officers"),
        jurisdiction_hints=("uk", "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland"),
        supported_fields=("company_name", "company_status", "incorporation_date", "hq_address", "industry", "company_number", "officers", "legal_form"),
        trust_weight=0.9,
        priority=3,
    ),
    "gleif": RegistryCapability(
        source_key="gleif",
        label="GLEIF / LEI Search",
        source_type="government_registry",
        adapter_kind="official_registry",
        keywords=("gleif", "lei", "legal entity identifier", "lei search", "global lei"),
        jurisdiction_hints=("global",),
        supported_fields=(
            "company_name",
            "legal_name",
            "lei",
            "registry_number",
            "company_status",
            "legal_form",
            "incorporation_date",
            "hq_address",
            "hq_city",
            "hq_country",
            "parent_company",
            "parent_lei",
            "ultimate_parent_company",
            "ultimate_parent_lei",
        ),
        trust_weight=0.94,
        priority=4,
    ),
    "wikidata": RegistryCapability(
        source_key="wikidata",
        label="Wikidata",
        source_type="knowledge_graph",
        adapter_kind="knowledge_graph",
        keywords=("wikidata", "wiki data", "knowledge graph"),
        jurisdiction_hints=("global",),
        supported_fields=(
            "company_name",
            "description",
            "hq_address",
            "hq_city",
            "hq_country",
            "industry",
            "employee_count",
            "annual_revenue",
            "year_founded",
            "parent_company",
            "subsidiaries",
            "website",
        ),
        trust_weight=0.62,
        priority=5,
    ),
}


REGISTRY_LABELS: Dict[str, str] = {
    key: capability.label for key, capability in REGISTRY_CAPABILITIES.items()
}


def normalize_registry_source_name(value: object) -> str:
    text = str(value or "").strip().lower().replace("-", "_").replace("/", "_").replace(" ", "")
    return REGISTRY_SOURCE_ALIASES.get(text, text)


def registry_source_label(source_key: str) -> str:
    return REGISTRY_LABELS.get(source_key, source_key or "Registry")


def registry_capability_for_source(source_key: str) -> Optional[RegistryCapability]:
    return REGISTRY_CAPABILITIES.get(normalize_registry_source_name(source_key))


def capabilities_in_priority_order(source_keys: Iterable[str]) -> List[RegistryCapability]:
    ordered: List[RegistryCapability] = []
    seen = set()
    for key in source_keys:
        normalized = normalize_registry_source_name(key)
        capability = REGISTRY_CAPABILITIES.get(normalized)
        if capability and capability.source_key not in seen:
            ordered.append(capability)
            seen.add(capability.source_key)
    return sorted(ordered, key=lambda item: item.priority)


def classify_registry_source_from_text(text: str) -> Optional[str]:
    haystack = (text or "").lower()
    for capability in REGISTRY_CAPABILITIES.values():
        if capability.matches_text(haystack):
            return capability.source_key
    return None
