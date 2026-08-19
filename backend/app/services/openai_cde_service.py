"""
OpenAI-based company data extraction for By Dataset enrichment.

This service runs after the existing scrapers have populated each row and only
fills blank fields. It does not overwrite scraper-provided values.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlparse

import httpx

from app.config import settings
from app.core.logger import setup_logger

logger = setup_logger(__name__)

_AI_BLANK_SENTINELS = {"", "n/a", "na", "null", "none", "nil", "-", "—"}
_OFFICIAL_REGISTRY_DOMAINS = [
    "sec.gov",
    "sec.report",
    "companieshouse.gov.uk",
    "find-and-update.company-information.service.gov.uk",
    "mca.gov.in",
    "europa.eu",
    "canada.ca",
    "ic.gc.ca",
]
_GENERAL_PUBLIC_DOMAINS = [
    "linkedin.com",
    "crunchbase.com",
    "wikipedia.org",
    "wikidata.org",
    "opencorporates.com",
    "craft.co",
    "zoominfo.com",
    "dnb.com",
    "bloomberg.com",
    "reuters.com",
    "forbes.com",
    "pitchbook.com",
]

_FIELD_ALIASES = {
    "company_name": ("company_name", "co_name", "legal_name", "entity_name", "name", "organization", "detected_company_name"),
    "website": ("website", "website_url", "company_website", "homepage", "homepage_url", "url", "domain", "source_url"),
    "description": ("description", "meta_description", "summary", "overview", "about", "company_description", "business_descrip", "extended_business_desc"),
    "tagline": ("tagline", "slogan", "motto", "strapline"),
    "logo_url": ("logo_url", "logo", "brand_logo_url"),
    "former_name": ("former_name", "co_former_name", "previous_name", "alias_name"),
    "former_name_date": ("former_name_date", "co_former_name_date"),
    "note_1": ("note_1", "co_note1", "note1"),
    "note_2": ("note_2", "co_note2", "note2"),
    "year_founded": ("year_founded", "founded_year", "incorporation_year", "founding_year"),
    "company_type": ("company_type", "entity_type", "business_type", "co_type"),
    "ownership": ("ownership", "ownership_type", "ownership_status"),
    "industry": ("industry", "sector", "vertical", "category"),
    "sub_industry": ("sub_industry", "subsector", "sub_sector", "niche"),
    "employee_count": ("employee_count", "employees", "headcount", "nbr_employees"),
    "employee_range": ("employee_range", "company_size", "size"),
    "hq_address": ("hq_address", "headquarters", "address", "registered_office_address", "business_address"),
    "hq_city": ("hq_city", "city", "headquarters_city"),
    "hq_state": ("hq_state", "state", "province", "region", "headquarters_state"),
    "hq_country": ("hq_country", "country", "headquarters_country"),
    "postal_code": ("postal_code", "zip", "postal_code1", "postal_code2", "postal_code3", "postalcode", "postcode"),
    "phone": ("phone", "phone_number", "contact_phone", "possible_phone", "telephone", "mobile"),
    "fax": ("fax", "fax_number"),
    "toll_free": ("toll_free", "toll_free_number", "tollfree"),
    "email": ("email", "email_address", "contact_email", "possible_email", "mail"),
    "linkedin_url": ("linkedin_url", "linkedin", "linkedin_profile", "contact_linkedin"),
    "twitter_url": ("twitter_url", "twitter_handle", "x_url"),
    "facebook_url": ("facebook_url", "facebook"),
    "youtube_url": ("youtube_url", "youtube", "youtube_channel", "youtube_url_1"),
    "cms": ("cms", "content_management_system"),
    "analytics": ("analytics", "analytics_platform"),
    "frameworks": ("frameworks", "frontend_frameworks", "frontend_stack"),
    "hosting": ("hosting", "host", "hosting_provider"),
    "tech_stack": ("tech_stack", "technology_stack", "stack"),
    "registry_number": ("registry_number", "cik", "cin", "lei", "vat_number", "tax_id", "co_ent_nbr", "entity_number"),
    "ultimate_parent_entity_number": ("ultimate_parent_entity_number", "ultimate_parent_entnbr", "ultimate_parent_ent_nbr"),
    "ultimate_parent_name": ("ultimate_parent_name", "ultimate_parent"),
    "immediate_parent_entity_number": ("immediate_parent_entity_number", "immediate_parent_entnbr", "immediate_parent_ent_nbr"),
    "immediate_parent_name": ("immediate_parent_name", "immediate_parent"),
    "address_line1": ("address_line1", "address1", "street_address1", "street_address", "hq_address_line1"),
    "address_line2": ("address_line2", "address2", "street_address2"),
    "address_line3": ("address_line3", "address3", "street_address3"),
    "mailing_address_line1": ("mailing_address_line1", "mailing_address1"),
    "mailing_address_line2": ("mailing_address_line2", "mailing_address2"),
    "mailing_address_line3": ("mailing_address_line3", "mailing_address3"),
    "mailing_postal_code1": ("mailing_postal_code1", "mailing_postalcode1", "mailing_zip"),
    "mailing_postal_code2": ("mailing_postal_code2", "mailing_postal_code2"),
    "mailing_postal_code3": ("mailing_postal_code3", "mailing_postal_code3"),
    "mailing_city": ("mailing_city", "mail_city"),
    "mailing_state": ("mailing_state", "mail_state"),
    "mailing_province": ("mailing_province",),
    "mailing_country": ("mailing_country", "mail_country"),
    "state_incorporated": ("state_incorporated", "state_incorp", "incorporation_state"),
    "ownership_percentage": ("ownership_percentage", "percentage_owned"),
    "fiscal_year_end_date": ("fiscal_year_end_date", "fiscal_yr_end_date"),
    "fye_mmdd": ("fye_mmdd",),
    "revenue_type": ("revenue_type",),
    "annual_revenue": ("annual_revenue", "sales", "revenue"),
    "net_income": ("net_income",),
    "assets": ("assets",),
    "liabilities": ("liabilities",),
    "net_worth": ("net_worth",),
    "lower_sales_range": ("lower_sales_range",),
    "upper_sales_range": ("upper_sales_range",),
    "ticker": ("ticker",),
    "stock_exchange_1": ("stock_exchange_1", "stock_exchange1"),
    "exchange_desc_1": ("exchange_desc_1", "exchange_desc1"),
    "stock_exchange_2": ("stock_exchange_2", "stock_exchange2"),
    "exchange_desc_2": ("exchange_desc_2", "exchange_desc2"),
    "stock_exchange_3": ("stock_exchange_3", "stock_exchange3"),
    "exchange_desc_3": ("exchange_desc_3", "exchange_desc3"),
    "stock_exchange_4": ("stock_exchange_4", "stock_exchange4"),
    "exchange_desc_4": ("exchange_desc_4", "exchange_desc4"),
    "stock_exchange_5": ("stock_exchange_5", "stock_exchange5"),
    "exchange_desc_5": ("exchange_desc_5", "exchange_desc5"),
    "stock_exchange_6": ("stock_exchange_6", "stock_exchange6"),
    "exchange_desc_6": ("exchange_desc_6", "exchange_desc6"),
    "cusip_number": ("cusip_number", "cusip_nbr"),
    "pension_ending_date": ("pension_ending_date",),
    "nbr_employee_benefits": ("nbr_employee_benefits",),
    "pension_assets": ("pension_assets",),
    "pension_type_1": ("pension_type_1", "pension_type1"),
    "pension_type_2": ("pension_type_2", "pension_type2"),
    "pension_type_3": ("pension_type_3", "pension_type3"),
    "pension_type_4": ("pension_type_4", "pension_type4"),
    "pension_type_5": ("pension_type_5", "pension_type5"),
    "pension_type_6": ("pension_type_6", "pension_type6"),
    "business_description": ("business_description", "business_descrip", "extended_business_desc"),
    "extended_business_description": ("extended_business_description", "extended_business_desc"),
    "primary_naics_code": ("primary_naics_code", "primary_naics_code1", "naics_code"),
    "last_update": ("last_update",),
    "isin_number": ("isin_number", "isin_nbr"),
    "fein_number": ("fein_number", "fein_nbr"),
    "cengage_fdr_id": ("cengage_fdr_id", "fdrid"),
    "cengage_organization_name": (
        "cengage_organization_name",
        "fdr_organization_name",
        "organization_name",
        "organization_name_a",
        "organization_name_b",
    ),
    "cengage_physical_street": (
        "cengage_physical_street",
        "fdr_physical_street",
        "physical_street",
        "physical_street_a",
        "physical_street_b",
    ),
    "cengage_organization_category": ("cengage_organization_category", "organization_category", "organization_category_a", "organization_category_b"),
    "cengage_organization_status": ("cengage_organization_status", "organization_status", "organization_status_a", "organization_status_b"),
    "cengage_organization_name_type": ("cengage_organization_name_type", "organization_name_type", "organization_name_type_a", "organization_name_type_b"),
    "cengage_acronym": ("cengage_acronym", "acronym", "acronym_a", "acronym_b"),
    "cengage_organization_relationship_type": (
        "cengage_organization_relationship_type",
        "organization_relationship_type",
        "organization_relationship_type_a",
        "organization_relationship_type_b",
    ),
    "cengage_inception_date": ("cengage_inception_date", "inception_date", "inception_date_a", "inception_date_b"),
    "cengage_main_url_address": ("cengage_main_url_address", "main_url_address", "main_url_address_a", "main_url_address_b"),
    "cengage_location_type": ("cengage_location_type", "location_type", "location_type_a", "location_type_b"),
    "cengage_address_status": ("cengage_address_status", "address_status", "address_status_a", "address_status_b"),
    "cengage_mailing_street": ("cengage_mailing_street", "mailing_street", "mailing_street_a", "mailing_street_b"),
    "cengage_mailing_city": ("cengage_mailing_city", "mailing_city", "mailing_city_a", "mailing_city_b"),
    "cengage_mailing_state": ("cengage_mailing_state", "mailing_state", "mailing_state_a", "mailing_state_b"),
    "cengage_mailing_country": ("cengage_mailing_country", "mailing_country", "mailing_country_a", "mailing_country_b"),
    "cengage_mailing_postal1": ("cengage_mailing_postal1", "mailing_postal1", "mailing_postal1_a", "mailing_postal1_b"),
    "cengage_mailing_subdivision": ("cengage_mailing_subdivision", "mailing_subdivision", "mailing_subdivision_a", "mailing_subdivision_b"),
    "cengage_physical_city": ("cengage_physical_city", "physical_city", "physical_city_a", "physical_city_b"),
    "cengage_physical_state": ("cengage_physical_state", "physical_state", "physical_state_a", "physical_state_b"),
    "cengage_physical_country": ("cengage_physical_country", "physical_country", "physical_country_a", "physical_country_b"),
    "cengage_physical_postal1": ("cengage_physical_postal1", "physical_postal1", "physical_postal1_a", "physical_postal1_b"),
    "cengage_physical_subdivision": ("cengage_physical_subdivision", "physical_subdivision", "physical_subdivision_a", "physical_subdivision_b"),
    "cengage_english_spoken": ("cengage_english_spoken", "english_spoken", "english_spoken_a", "english_spoken_b"),
    "cengage_status": ("cengage_status", "status"),
    "cengage_variant_name": ("cengage_variant_name", "variant_name", "variant_name_a", "variant_name_b"),
    "cengage_prefix": ("cengage_prefix", "prefix", "prefix_a", "prefix_b"),
    "cengage_first_name": ("cengage_first_name", "first_name", "first_name_a", "first_name_b"),
    "cengage_middle_name": ("cengage_middle_name", "middle_name", "middle_name_a", "middle_name_b"),
    "cengage_last_name": ("cengage_last_name", "last_name", "last_name_a", "last_name_b"),
    "cengage_suffix": ("cengage_suffix", "suffix", "suffix_a", "suffix_b"),
    "cengage_employee_title": ("cengage_employee_title", "employee_title", "employee_title_a", "employee_title_b"),
    "cengage_employee_title_text": ("cengage_employee_title_text", "employee_title_text", "employee_title_text_a", "employee_title_text_b"),
    "cengage_email_address": ("cengage_email_address", "email_address", "email_address_a", "email_address_b"),
    "cengage_final_status": ("cengage_final_status", "final_status"),
    "cengage_phone_type": ("cengage_phone_type", "phone_type", "phonetype", "phone_type_a", "phone_type_b"),
    "cengage_country_calling_code": ("cengage_country_calling_code", "country_calling_code", "country_calling_code_a", "country_calling_code_b"),
    "cengage_city_code": ("cengage_city_code", "city_code", "city_code_a", "city_code_b"),
    "cengage_area_code": ("cengage_area_code", "area_code", "area_code_a", "area_code_b"),
    "cengage_phone_number": ("cengage_phone_number", "phone_number", "phone_number_a", "phone_number_b"),
    "cengage_phone_text": ("cengage_phone_text", "phone_text", "phone_text_a", "phone_text_b"),
    "cengage_social_media_type": ("cengage_social_media_type", "social_media_type", "social_media_type_a", "social_media_type_b"),
    "cengage_social_media_handle": ("cengage_social_media_handle", "social_media_handle", "social_media_handle_a", "social_media_handle_b"),
    "cengage_url_address": ("cengage_url_address", "url_address", "url_address_a", "url_address_b"),
}

_FIELD_ALIAS_GROUPS: List[tuple[str, ...]] = []
_FIELD_ALIAS_LOOKUP: Dict[str, str] = {}


def _ensure_alias_indexes() -> None:
    if _FIELD_ALIAS_GROUPS and _FIELD_ALIAS_LOOKUP:
        return
    if _FIELD_ALIAS_GROUPS or _FIELD_ALIAS_LOOKUP:
        _FIELD_ALIAS_GROUPS.clear()
        _FIELD_ALIAS_LOOKUP.clear()
    for canonical_name, aliases in _FIELD_ALIASES.items():
        group = tuple(dict.fromkeys((canonical_name, *aliases)))
        _FIELD_ALIAS_GROUPS.append(group)
        canonical_norm = _normalize_key(canonical_name)
        for alias_name in group:
            alias_norm = _normalize_key(alias_name)
            if alias_norm:
                _FIELD_ALIAS_LOOKUP[alias_norm] = canonical_norm


def _expand_aliases(value: Any) -> List[str]:
    _ensure_alias_indexes()
    normalized = _normalize_key(value)
    if not normalized:
        return []
    canonical_norm = _FIELD_ALIAS_LOOKUP.get(normalized, normalized)
    for group in _FIELD_ALIAS_GROUPS:
        if canonical_norm == _normalize_key(group[0]):
            return [_normalize_key(item) for item in group if _normalize_key(item)]
    return [normalized]


def _field_matches_requested(field: Any, requested_fields: List[str]) -> bool:
    _ensure_alias_indexes()
    if not requested_fields:
        return True
    field_norms = set(_expand_aliases(field))
    if not field_norms:
        return False
    requested_norms: set[str] = set()
    for requested_field in requested_fields:
        requested_norms.update(_expand_aliases(requested_field))
        requested_norm = _normalize_key(requested_field)
        if requested_norm:
            requested_norms.add(requested_norm)
    return bool(field_norms.intersection(requested_norms))


def _alias_hints(field: Any) -> List[str]:
    _ensure_alias_indexes()
    field_norm = _normalize_key(field)
    if not field_norm:
        return []
    canonical_norm = _FIELD_ALIAS_LOOKUP.get(field_norm, field_norm)
    for group in _FIELD_ALIAS_GROUPS:
        group_norm = _normalize_key(group[0])
        if group_norm != canonical_norm:
            continue
        return [item for item in group if _normalize_key(item) and _normalize_key(item) != field_norm]
    return []


def _should_skip_ai_field(field: Any) -> bool:
    field_norm = _normalize_key(field)
    if not field_norm:
        return True
    if field_norm.startswith("disposition_"):
        return True
    return field_norm in {"fdrid", "final_status"}


def _discover_record_fields(records: List[Dict[str, Any]]) -> List[str]:
    discovered: List[str] = []
    seen: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            continue
        for key, value in record.items():
            if str(key).startswith("_"):
                continue
            if _should_skip_ai_field(key):
                continue
            if _is_blank_like(value):
                key_norm = _normalize_key(key)
                if not key_norm:
                    continue
                if key_norm in seen:
                    continue
                seen.add(key_norm)
                discovered.append(str(key))
                continue
            for alias_name in _alias_hints(key):
                alias_norm = _normalize_key(alias_name)
                if not alias_norm or alias_norm in seen:
                    continue
                seen.add(alias_norm)
                discovered.append(alias_name)
    return discovered


def _merge_field_lists(*lists: List[str]) -> List[str]:
    merged: List[str] = []
    seen: set[str] = set()
    for items in lists:
        for item in items:
            normalized = _normalize_key(item)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            merged.append(str(item).strip())
    return merged


def _normalize_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def _is_blank_like(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip().lower() in _AI_BLANK_SENTINELS
    if isinstance(value, (list, tuple, set, dict)):
        return not bool(value)
    return False


def _dedupe(values: Iterable[str]) -> List[str]:
    seen: set[str] = set()
    ordered: List[str] = []
    for value in values:
        cleaned = str(value or "").strip().lower()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        ordered.append(cleaned)
    return ordered


def _extract_domain(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    if "@" in text and "://" not in text:
        return None
    if "://" not in text:
        text = f"https://{text}"
    try:
        parsed = urlparse(text)
    except Exception:
        return None
    host = (parsed.netloc or "").strip().lower()
    if host.startswith("www."):
        host = host[4:]
    if not host or "." not in host:
        return None
    return host


def _build_allowed_domains(record: Dict[str, Any], workflow_ids: Optional[List[str]] = None) -> List[str]:
    domains: List[str] = []
    for key in (
        "website",
        "website_url",
        "source",
        "source_url",
        "corp_site",
        "url",
        "domain",
    ):
        domain = _extract_domain(record.get(key))
        if domain:
            domains.append(domain)

    if workflow_ids:
        workflow_text = " ".join(str(item).strip().lower() for item in workflow_ids)
        if any(token in workflow_text for token in ("sec", "edgar")):
            domains.extend(["sec.gov", "sec.report"])
        if any(token in workflow_text for token in ("mca", "registry")):
            domains.append("mca.gov.in")
        if "companies" in workflow_text or "house" in workflow_text:
            domains.extend(["companieshouse.gov.uk", "find-and-update.company-information.service.gov.uk"])

    domains.extend(_OFFICIAL_REGISTRY_DOMAINS)
    domains.extend(_GENERAL_PUBLIC_DOMAINS)
    return _dedupe(domains)[:12]


def _summarize_record(record: Dict[str, Any], requested_fields: List[str]) -> Dict[str, Any]:
    summary: Dict[str, Any] = {}
    for key, value in record.items():
        if str(key).startswith("_"):
            continue
        if _is_blank_like(value):
            continue
        summary[key] = value

    source_evidence: Dict[str, Any] = {}
    for context_key in (
        "_source_context",
        "_scraper_context",
        "_registry_context",
        "_tech_context",
        "_ai_context",
    ):
        context_value = record.get(context_key)
        if not isinstance(context_value, dict) or not context_value:
            continue
        compact_context: Dict[str, Any] = {}
        for ctx_key, ctx_value in context_value.items():
            if _is_blank_like(ctx_value):
                continue
            if isinstance(ctx_value, (dict, list, tuple, set)):
                try:
                    ctx_value = json.dumps(ctx_value, ensure_ascii=False, default=str)
                except Exception:
                    ctx_value = str(ctx_value)
            else:
                ctx_value = str(ctx_value) if not isinstance(ctx_value, (str, int, float, bool)) else ctx_value
            ctx_text = str(ctx_value).strip()
            if not ctx_text:
                continue
            if len(ctx_text) > 800:
                ctx_text = ctx_text[:800]
            compact_context[ctx_key] = ctx_text
        if compact_context:
            source_evidence[context_key.lstrip("_")] = compact_context

    if source_evidence:
        summary["source_evidence"] = source_evidence

    if requested_fields:
        filtered: Dict[str, Any] = {}
        for key, value in summary.items():
            if key == "source_evidence" or _field_matches_requested(key, requested_fields):
                filtered[key] = value
        for key in ("company_name", "legal_name", "website", "website_url", "source", "source_name", "domain", "country", "registry_number", "ticker"):
            if key in summary:
                filtered.setdefault(key, summary[key])
        return filtered
    return summary


def _build_prompt(batch: List[Dict[str, Any]], requested_fields: List[str]) -> str:
    field_lines = "\n".join(
        f"- {field}" + (f" (aliases: {', '.join(_alias_hints(field))})" if _alias_hints(field) else "")
        for field in requested_fields
    )
    record_blocks: List[str] = []
    for item in batch:
        record_blocks.append(
            f"""Record {item['record_index']}:
Company: {item['entity']}
Current known values:
{json.dumps(item['current_values'], ensure_ascii=False, default=str, indent=2)}
"""
        )
    return f"""You are a corporate data extraction assistant for a By Dataset workflow.

Use the current row values first. Prefer the company website and official government or registry sources.
When those are thin or blocked, you may use broadly trusted public company sources such as LinkedIn, Crunchbase, Wikipedia, Wikidata, OpenCorporates, Reuters, Bloomberg, or similar public references.
Do not overwrite values that are already present in the current row.
For missing fields, return the most likely value you can support from the available evidence.
If a field is truly unknown, return an empty string.

Requested fields:
{field_lines}

Return a plain JSON object only. Keep it flexible:
- You may return a direct object with the requested field names.
- You may return a single-item object with `record_index`, `entity`, and `extracted`.
- You may return a `records` array if that is easier.
- Extra keys are acceptable if they help explain the answer, but do not add prose.

Records:
{chr(10).join(record_blocks)}
"""


def _response_text(payload: Dict[str, Any]) -> str:
    # Responses API format: output_text or output[].content[].text
    text = payload.get("output_text")
    if isinstance(text, str) and text.strip():
        return text
    for output_item in payload.get("output") or []:
        if not isinstance(output_item, dict):
            continue
        for content_item in output_item.get("content") or []:
            if not isinstance(content_item, dict):
                continue
            if content_item.get("type") in {"output_text", "text"}:
                text_value = content_item.get("text")
                if isinstance(text_value, str) and text_value.strip():
                    return text_value
    # Chat Completions API format: choices[0].message.content
    for choice in payload.get("choices") or []:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message") or {}
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, str) and content.strip():
            return content
    return ""


def _build_schema(requested_fields: List[str]) -> Dict[str, Any]:
    extracted_props = {field: {"type": "string"} for field in requested_fields}
    return {
        "type": "object",
        "properties": {
            "records": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "record_index": {"type": "integer"},
                        "entity": {"type": "string"},
                        "extracted": {
                            "type": "object",
                            "properties": extracted_props,
                            "additionalProperties": True,
                        },
                    },
                    "required": ["record_index", "entity", "extracted"],
                    "additionalProperties": True,
                },
            }
        },
        "required": ["records"],
        "additionalProperties": True,
    }


def _parse_json_response(text: str) -> Optional[Dict[str, Any]]:
    raw_text = str(text or "").strip()
    if not raw_text:
        return None

    candidates = [raw_text]

    # Strip markdown code fences: ```json ... ``` or ``` ... ```
    if raw_text.startswith("```"):
        # Remove opening fence line (```json or ```)
        fenced = re.sub(r"^```[a-zA-Z]*\n?", "", raw_text).strip()
        # Remove closing fence
        fenced = re.sub(r"```$", "", fenced).strip()
        if fenced:
            candidates.insert(0, fenced)

    start_positions = [pos for pos in (raw_text.find("{"), raw_text.find("[")) if pos >= 0]
    if start_positions:
        candidates.append(raw_text[min(start_positions):])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except Exception:
            continue
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            return {"records": parsed}
    return None


def _project_direct_fields(payload: Dict[str, Any], requested_fields: List[str]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    requested_lookup: set[str] = set()
    for field in requested_fields:
        requested_lookup.update(_expand_aliases(field))
        normalized_field = _normalize_key(field)
        if normalized_field:
            requested_lookup.add(normalized_field)
    extracted = payload.get("extracted")
    if isinstance(extracted, dict) and extracted:
        return extracted

    projected: Dict[str, Any] = {}
    for key, value in payload.items():
        if str(key).startswith("_"):
            continue
        if key in {"record_index", "entity", "records"}:
            continue
        if isinstance(value, (dict, list, tuple, set)):
            continue
        normalized_key = _normalize_key(key)
        if requested_lookup and normalized_key not in requested_lookup:
            continue
        projected[str(key)] = value
    return projected


def merge_openai_cde_values(
    record: Dict[str, Any],
    extracted: Dict[str, Any],
    requested_fields: Optional[List[str]] = None,
    *,
    confidence: int = 80,
    source: str = "openai_cde",
    reason: str = "Filled by OpenAI CDE because the field was blank or missing.",
) -> Dict[str, Any]:
    """Fill only blank fields and attach provenance metadata."""

    merged = dict(record or {})
    requested_lookup: set[str] = set()
    requested_original_lookup: Dict[str, str] = {}
    for field in (requested_fields or []):
        normalized_field = _normalize_key(field)
        if normalized_field:
            requested_lookup.add(normalized_field)
            requested_original_lookup.setdefault(normalized_field, str(field))
        for alias_norm in _expand_aliases(field):
            requested_lookup.add(alias_norm)
            requested_original_lookup.setdefault(alias_norm, str(field))
    existing_lookup = {
        _normalize_key(key): key
        for key in merged.keys()
        if not str(key).startswith("_")
    }
    provenance = dict(merged.get("_field_provenance") or {})
    ai_meta = dict(merged.get("_ai_enrichment") or {})
    filled_fields: Dict[str, Any] = {}

    for raw_key, raw_value in (extracted or {}).items():
        if _is_blank_like(raw_value):
            continue
        if _should_skip_ai_field(raw_key):
            continue

        normalized_key = _normalize_key(raw_key)
        if not normalized_key:
            continue

        candidate_norms = set(_expand_aliases(raw_key))
        candidate_norms.add(normalized_key)

        target_key = ""
        for candidate_norm in candidate_norms:
            existing_key = existing_lookup.get(candidate_norm)
            if existing_key:
                target_key = existing_key
                break
        if not target_key:
            for candidate_norm in candidate_norms:
                requested_key = requested_original_lookup.get(candidate_norm)
                if requested_key:
                    target_key = requested_key
                    break
        if not target_key:
            target_key = str(raw_key)
        if _should_skip_ai_field(target_key):
            continue

        if requested_lookup:
            target_normalized = _normalize_key(target_key)
            if (
                not candidate_norms.intersection(requested_lookup)
                and target_normalized not in requested_lookup
                and normalized_key not in existing_lookup
                and target_normalized not in existing_lookup
            ):
                continue

        if target_key.startswith("_"):
            continue
        if not _is_blank_like(merged.get(target_key)):
            continue

        value = str(raw_value).strip()
        merged[target_key] = value
        existing_lookup[_normalize_key(target_key)] = target_key
        provenance[target_key] = {
            "source": source,
            "confidence": confidence,
            "reason": reason,
        }
        filled_fields[target_key] = value

    if filled_fields:
        ai_meta.update(
            {
                "source": source,
                "confidence": confidence,
                "filled_fields": filled_fields,
                "field_provenance": {k: provenance[k] for k in filled_fields.keys()},
            }
        )
        merged["_ai_enrichment"] = ai_meta
        merged["_field_provenance"] = provenance

    return merged

class OpenAICDEService:
    def __init__(self) -> None:
        self.responses_endpoint = "https://api.openai.com/v1/responses"
        self.chat_endpoint = "https://api.openai.com/v1/chat/completions"
        self.default_timeout = max(60, int(getattr(settings, "AI_REQUEST_TIMEOUT_SEC", 30) or 30))

    async def extract_dataset_data(
        self,
        *,
        records: List[Dict[str, Any]],
        requested_fields: Optional[List[str]] = None,
        workflow_ids: Optional[List[str]] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        if not records:
            return []

        resolved_key = str(api_key or settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY") or "").strip()
        if not resolved_key:
            logger.warning("OPENAI_API_KEY is not configured; skipping OpenAI CDE enrichment.")
            return []

        target_fields = [str(field).strip() for field in (requested_fields or []) if str(field).strip()]
        discovered_fields = _discover_record_fields(records)
        if target_fields:
            target_fields = _merge_field_lists(target_fields, discovered_fields)
        else:
            sample = records[0] if records else {}
            target_fields = [key for key in sample.keys() if not str(key).startswith("_")]
            target_fields = _merge_field_lists(target_fields, discovered_fields)

        model_name = str(model or settings.OPENAI_MODEL or "gpt-4o-mini").strip()
        batch_size = 1
        field_chunk_size = 8
        results: List[Dict[str, Any]] = [{"entity": "", "extracted": {}} for _ in records]

        for batch_start in range(0, len(records), batch_size):
            batch_records = records[batch_start:batch_start + batch_size]
            batch_payload: List[Dict[str, Any]] = []
            for offset, record in enumerate(batch_records):
                entity = str(
                    record.get("company_name")
                    or record.get("legal_name")
                    or record.get("company")
                    or record.get("source_name")
                    or record.get("website")
                    or record.get("website_url")
                    or record.get("source")
                    or f"Record {batch_start + offset}"
                ).strip()
                batch_payload.append(
                    {
                        "record_index": batch_start + offset,
                        "entity": entity,
                        "current_values": _summarize_record(record, target_fields),
                    }
                )

            allowed_domains = []
            for item in batch_records:
                allowed_domains.extend(_build_allowed_domains(item, workflow_ids))
            allowed_domains = _dedupe(allowed_domains)[:12]

            for field_start in range(0, len(target_fields), field_chunk_size):
                field_chunk = target_fields[field_start:field_start + field_chunk_size]
                if not field_chunk:
                    continue

                prompt = _build_prompt(batch_payload, field_chunk)

                system_content = (
                    "You extract company data and return only valid JSON. "
                    "Fill every requested field you can support from trustworthy sources. "
                    "Prefer the company website and official registry or investor-relations sources. "
                    "Use public business sources when official sources are unavailable."
                )

                # Attempt 1: Responses API with web_search (richer, but gated on plan)
                # temperature is NOT a valid param for the Responses API — omit it.
                # Note: allowed_domains filter is NOT supported on gpt-4o-mini, use plain web_search
                responses_body: Dict[str, Any] = {
                    "model": model_name,
                    "input": [
                        {"role": "system", "content": system_content},
                        {"role": "user", "content": prompt},
                    ],
                    "tools": [{"type": "web_search"}],
                }

                # Attempt 2: Chat Completions API — universally supported, no web_search
                chat_body: Dict[str, Any] = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": system_content},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0,
                }

                request_attempts = [
                    (self.responses_endpoint, responses_body),
                    (self.chat_endpoint, chat_body),
                ]

                chunk_succeeded = False
                for attempt_index, (endpoint_url, request_body) in enumerate(request_attempts):
                    try:
                        async with httpx.AsyncClient(timeout=self.default_timeout) as client:
                            response = await client.post(
                                endpoint_url,
                                headers={
                                    "Authorization": f"Bearer {resolved_key}",
                                    "Content-Type": "application/json",
                                },
                                json=request_body,
                            )
                        if not response.is_success:
                            logger.warning(
                                "OpenAI CDE request failed for batch starting at %s field chunk %s (attempt %s): %s",
                                batch_start,
                                field_start,
                                attempt_index + 1,
                                response.text[:500],
                            )
                            continue

                        payload = response.json()
                        text = _response_text(payload)
                        if not text.strip():
                            logger.warning(
                                "OpenAI CDE returned no structured text for batch starting at %s field chunk %s (attempt %s)",
                                batch_start,
                                field_start,
                                attempt_index + 1,
                            )
                            continue

                        parsed = _parse_json_response(text)
                        if not isinstance(parsed, dict):
                            logger.warning(
                                "OpenAI CDE returned unparsable JSON for batch starting at %s field chunk %s (attempt %s): %s",
                                batch_start,
                                field_start,
                                attempt_index + 1,
                                text[:500],
                            )
                            continue

                        records_output = parsed.get("records")
                        if isinstance(records_output, dict):
                            records_output = [records_output]
                        if not isinstance(records_output, list):
                            records_output = [parsed]

                        for offset, item in enumerate(records_output):
                            if not isinstance(item, dict):
                                continue
                            idx = item.get("record_index")
                            if not isinstance(idx, int) or idx < batch_start or idx >= batch_start + len(batch_records):
                                idx = batch_start + min(offset, max(0, len(batch_records) - 1))
                            entity = str(item.get("entity") or "").strip()
                            extracted = item.get("extracted") if isinstance(item.get("extracted"), dict) else {}
                            if not extracted:
                                extracted = _project_direct_fields(item, field_chunk)
                            if not extracted and item is parsed:
                                extracted = _project_direct_fields(parsed, field_chunk)
                            if entity and not results[idx]["entity"]:
                                results[idx]["entity"] = entity
                            elif not results[idx]["entity"]:
                                results[idx]["entity"] = batch_payload[idx - batch_start]["entity"]
                            if not isinstance(extracted, dict) or not extracted:
                                extracted = {
                                    key: value
                                    for key, value in item.items()
                                    if key in field_chunk and not str(key).startswith("_") and not isinstance(value, (dict, list))
                                }
                            if not isinstance(extracted, dict) or not extracted:
                                continue
                            for key, value in extracted.items():
                                if _is_blank_like(value):
                                    continue
                                value_text = str(value).strip()
                                if not value_text:
                                    continue
                                current = results[idx]["extracted"].get(str(key))
                                if _is_blank_like(current):
                                    results[idx]["extracted"][str(key)] = value_text
                        chunk_succeeded = True
                        break
                    except Exception as exc:
                        logger.warning(
                            "OpenAI CDE enrichment failed for batch starting at %s field chunk %s (attempt %s): %s",
                            batch_start,
                            field_start,
                            attempt_index + 1,
                            exc,
                        )
                if not chunk_succeeded:
                    logger.warning(
                        "OpenAI CDE could not enrich batch starting at %s field chunk %s after retries",
                        batch_start,
                        field_start,
                    )

        return results


openai_cde_service = OpenAICDEService()
