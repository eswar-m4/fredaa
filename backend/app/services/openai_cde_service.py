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
    "company_name": ("company_name", "legal_name", "entity_name", "name", "organization", "detected_company_name"),
    "website": ("website", "website_url", "company_website", "homepage", "homepage_url", "url", "domain", "source_url"),
    "description": ("description", "meta_description", "summary", "overview", "about", "company_description"),
    "tagline": ("tagline", "slogan", "motto", "strapline"),
    "logo_url": ("logo_url", "logo", "brand_logo_url"),
    "year_founded": ("year_founded", "founded_year", "incorporation_year", "founding_year"),
    "company_type": ("company_type", "entity_type", "business_type"),
    "ownership": ("ownership", "ownership_type", "ownership_status"),
    "industry": ("industry", "sector", "vertical", "category"),
    "sub_industry": ("sub_industry", "subsector", "sub_sector", "niche"),
    "employee_count": ("employee_count", "employees", "headcount"),
    "employee_range": ("employee_range", "company_size", "size"),
    "hq_address": ("hq_address", "headquarters", "address", "registered_office_address", "business_address", "mailing_address"),
    "hq_city": ("hq_city", "city", "headquarters_city"),
    "hq_state": ("hq_state", "state", "province", "region", "headquarters_state"),
    "hq_country": ("hq_country", "country", "headquarters_country"),
    "phone": ("phone", "phone_number", "contact_phone", "possible_phone", "telephone", "mobile"),
    "email": ("email", "email_address", "contact_email", "possible_email", "mail"),
    "linkedin_url": ("linkedin_url", "linkedin", "linkedin_profile", "contact_linkedin"),
    "twitter_url": ("twitter_url", "twitter_handle", "x_url"),
    "facebook_url": ("facebook_url", "facebook"),
    "cms": ("cms", "content_management_system"),
    "analytics": ("analytics", "analytics_platform"),
    "frameworks": ("frameworks", "frontend_frameworks", "frontend_stack"),
    "hosting": ("hosting", "host", "hosting_provider"),
    "tech_stack": ("tech_stack", "technology_stack", "stack"),
    "registry_number": ("registry_number", "cik", "cin", "lei", "vat_number", "tax_id"),
    "dba": ("dba", "doing_business_as", "trading_name", "trade_name", "dba_name", "brand_name"),
    "tags": ("tags", "business_tags", "keywords", "labels", "categories", "topics"),
    "investors": ("investors", "backers", "venture_investors", "funding_investors", "shareholders"),
    "ceo_email": ("ceo_email", "chief_executive_email", "ceo_contact_email"),
    "executives": ("executives", "leadership_team", "executive_team", "management_team", "leadership", "c_suite"),
    "board_members": ("board_members", "board", "board_of_directors", "directors", "governing_board"),
    "office_locations": ("office_locations", "offices", "locations", "branch_locations", "additional_offices"),
}


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
        requested_lookup = {_normalize_key(field) for field in requested_fields}
        filtered: Dict[str, Any] = {}
        for key, value in summary.items():
            if key == "source_evidence" or _normalize_key(key) in requested_lookup:
                filtered[key] = value
        for key in ("company_name", "legal_name", "website", "website_url", "source", "source_name", "domain", "country", "registry_number", "ticker"):
            if key in summary:
                filtered.setdefault(key, summary[key])
        return filtered
    return summary


def _build_prompt(batch: List[Dict[str, Any]], requested_fields: List[str]) -> str:
    field_lines = "\n".join(f"- {field}" for field in requested_fields)
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

Use the current row values first. For missing fields, search broadly — company website, official registries,
Google Knowledge Graph, ZoomInfo, LinkedIn, Crunchbase, Bloomberg, Reuters, Wikipedia, Wikidata,
OpenCorporates, Glassdoor, news articles, and any other reliable public source.
There are no domain restrictions. Let the best available evidence guide your answer.
Do not overwrite values that are already present in the current row.
If a field is truly unknown after broad search, return an empty string.

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

    if raw_text.startswith("```"):
        fenced = re.sub(r"^```[a-zA-Z]*\n?", "", raw_text).strip()
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

    requested_lookup = {_normalize_key(field) for field in requested_fields if _normalize_key(field)}
    alias_lookup = set(requested_lookup)
    for canonical_name, aliases in _FIELD_ALIASES.items():
        candidate_norms = {_normalize_key(canonical_name), *(_normalize_key(alias) for alias in aliases)}
        if requested_lookup.intersection(candidate_norms):
            alias_lookup.update(candidate_norms)
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
        if alias_lookup and normalized_key not in alias_lookup:
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
    requested_lookup = {_normalize_key(field) for field in (requested_fields or []) if _normalize_key(field)}
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

        normalized_key = _normalize_key(raw_key)
        if not normalized_key:
            continue

        target_key = existing_lookup.get(normalized_key) or normalized_key
        if _normalize_key(target_key) != normalized_key:
            for canonical_name, aliases in _FIELD_ALIASES.items():
                candidate_names = (canonical_name, *aliases)
                candidate_norms = {_normalize_key(name) for name in candidate_names}
                if normalized_key not in candidate_norms:
                    continue

                matching_names: List[str] = []
                for candidate_name in candidate_names:
                    candidate_norm = _normalize_key(candidate_name)
                    if requested_lookup and candidate_norm not in requested_lookup:
                        continue
                    if candidate_norm in existing_lookup:
                        matching_names.append(existing_lookup[candidate_norm])
                    elif not requested_lookup or candidate_norm in requested_lookup:
                        matching_names.append(candidate_name)

                if not matching_names:
                    for candidate_name in candidate_names:
                        candidate_norm = _normalize_key(candidate_name)
                        if candidate_norm in existing_lookup:
                            matching_names.append(existing_lookup[candidate_norm])
                            break
                    if not matching_names and not requested_lookup:
                        matching_names.append(canonical_name)

                if matching_names:
                    target_key = matching_names[0]
                break

        if requested_lookup:
            target_normalized = _normalize_key(target_key)
            if (
                normalized_key not in requested_lookup
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
        if not target_fields:
            sample = records[0] if records else {}
            target_fields = [key for key in sample.keys() if not str(key).startswith("_")]

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
                    "Fill every requested field you can support from any available source. "
                    "Search broadly: company website, official registries, Google Knowledge Graph, "
                    "ZoomInfo, LinkedIn, Crunchbase, Bloomberg, Reuters, Wikipedia, Wikidata, "
                    "OpenCorporates, news articles, and any other reliable public source. "
                    "There are no domain restrictions — follow the best available evidence."
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
