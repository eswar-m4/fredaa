"""
Gemini AI Fallback Service for F.R.E.D.A BY Dataset Enrichment.

Provides fallback extraction for missing attributes using Lovable AI Gateway / Gemini 3 Flash.
"""

import json
import os
import re
from typing import Any, Dict, List, Optional
import httpx

from app.config import settings
from app.core.logger import setup_logger

logger = setup_logger(__name__)

AI_FALLBACK_CONFIDENCE = 50
_BLANK_SENTINELS = {"", "n/a", "na", "null", "none", "nil", "nil value", "-"}


def _normalize_field_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def _is_blank_like(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return str(value).strip().lower() in _BLANK_SENTINELS
    if isinstance(value, (list, tuple, set, dict)):
        return not bool(value)
    return False


def _requested_field_lookup(requested_fields: Optional[List[str]]) -> set[str]:
    return {
        key
        for key in (_normalize_field_key(field) for field in (requested_fields or []))
        if key
    }


def _parse_ai_items(ai_content: str) -> List[Any]:
    if not ai_content:
        return []

    parsed: Any = None
    code_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", ai_content)
    if code_match:
        try:
            parsed = json.loads(code_match.group(1).strip())
        except Exception:
            parsed = None

    if parsed is None:
        try:
            cleaned = re.sub(r"```json\n?", "", ai_content)
            cleaned = re.sub(r"```\n?", "", cleaned).strip()
            parsed = json.loads(cleaned)
        except Exception:
            parsed = None

    if isinstance(parsed, list):
        return parsed
    return []


def merge_ai_fallback_values(
    record: Dict[str, Any],
    extracted: Dict[str, Any],
    requested_fields: Optional[List[str]] = None,
    *,
    confidence: int = AI_FALLBACK_CONFIDENCE,
    source: str = "ai_fallback",
    reason: str = "Filled by AI fallback because the field was blank or missing.",
) -> Dict[str, Any]:
    """Fill only blank fields and attach provenance metadata."""

    merged = dict(record or {})
    requested_lookup = _requested_field_lookup(requested_fields)
    existing_lookup = {
        _normalize_field_key(key): key
        for key in merged.keys()
        if not str(key).startswith("_")
    }
    provenance = dict(merged.get("_field_provenance") or {})
    ai_meta = dict(merged.get("_ai_enrichment") or {})
    filled_fields: Dict[str, Any] = {}

    for raw_key, raw_value in (extracted or {}).items():
        if _is_blank_like(raw_value):
            continue

        normalized_key = _normalize_field_key(raw_key)
        if not normalized_key:
            continue

        if requested_lookup and normalized_key not in requested_lookup:
            if normalized_key not in existing_lookup:
                continue

        target_key = existing_lookup.get(normalized_key) or normalized_key
        if target_key.startswith("_"):
            continue
        if not _is_blank_like(merged.get(target_key)):
            continue

        value = str(raw_value).strip()
        merged[target_key] = value
        existing_lookup[_normalize_field_key(target_key)] = target_key
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

WORKFLOW_SOURCES: Dict[str, Dict[str, Any]] = {
    "company_data": {
        "sourceName": "Company Website",
        "sourceUrlHint": "the company's official website",
        "attributes": [
            "Legal Name", "Trade Name", "Country", "Address", "City", "State",
            "Postal Code", "Website", "Email", "Phone", "Fax",
            "Foundation Year", "Number of Employees", "Business Description",
            "Social Media Profiles",
        ],
    },
    "sec_data": {
        "sourceName": "SEC EDGAR",
        "sourceUrlHint": "https://www.sec.gov/search-filings",
        "attributes": [
            "Revenue (USD-normalized)", "Assets", "Liabilities", "Net Income",
            "Fiscal Year End", "NAICS/SIC Codes", "Ticker Symbol",
        ],
    },
    "stock_exchange": {
        "sourceName": "Nasdaq",
        "sourceUrlHint": "https://www.nasdaq.com/market-activity/stocks",
        "attributes": [
            "Ticker Symbol", "Stock Exchange", "Status",
        ],
    },
    "registry_data": {
        "sourceName": "Annual Report (Govt Filing)",
        "sourceUrlHint": "the company's most recent annual report (PDF) published on its investor relations site or filed with the relevant government authority",
        "attributes": [
            "Registration ID(s)", "Organizational Type",
            "Ultimate Parent", "Subsidiary Company", "Entity Type",
            "Hierarchy Level", "Relationship Type", "Performance Expectation",
        ],
    },
    "labor_market": {
        "sourceName": "Labor Market Intelligence",
        "sourceUrlHint": "publicly available labor market intelligence sources including LinkedIn company pages, job boards, Crunchbase, Glassdoor, and similar workforce/talent data sources",
        "attributes": [
            "Industry", "Company Headcount", "Company Name", "Hiring Rate",
            "Attrition Rate", "Growth Rate", "Job Postings", "Sentiment",
            "Founders", "Average Tenure", "Average Salary", "Geography",
            "Keywords", "Skills", "Activities", "Previous Company",
            "Funding Rounds", "Investors",
        ],
    },
}


def unique_attributes_for_workflows(workflow_ids: List[str]) -> List[str]:
    seen = set()
    out = []
    for wf_id in workflow_ids:
        wf = WORKFLOW_SOURCES.get(wf_id)
        if not wf:
            continue
        for attr in wf.get("attributes", []):
            if attr not in seen:
                seen.add(attr)
                out.append(attr)
    return out


def build_labor_market_prompt(entities: List[str]) -> str:
    wf = WORKFLOW_SOURCES["labor_market"]
    source_line = f"  - {wf['sourceName']} ({wf['sourceUrlHint']}) \u2192 {', '.join(wf['attributes'])}"

    company_lines = "\n".join(f"- {c}" for c in entities)

    return f"""You are a Labor Market Intelligence Extraction Assistant. For each company below, extract workforce, hiring, talent, and company-growth intelligence attributes ONLY from the selected sources.

Selected sources (each authoritative for its listed attributes):
{source_line}

Attributes to extract (in the exact order below):
1. Industry (text)
2. Company Headcount (number)
3. Company Name (text)
4. Hiring Rate (percentage)
5. Attrition Rate (percentage)
6. Growth Rate (percentage)
7. Job Postings (number / multi-value if applicable)
8. Sentiment (text)
9. Founders (text / multi-value)
10. Average Tenure (number)
11. Average Salary (currency)
12. Geography (text)
13. Keywords (text / multi-value)
14. Skills (text / multi-value)
15. Activities (text / multi-value)
16. Previous Company (text / multi-value)
17. Funding Rounds (text / multi-value)
18. Investors (text / multi-value)

Output Rules:
- Return ONLY a valid JSON array of arrays. No markdown, explanations, notes, or commentary.
- Each inner array MUST contain exactly 19 elements in the following order:
  1. Company Identifier (echo back exactly as provided)
  2. Industry
  3. Company Headcount
  4. Company Name
  5. Hiring Rate
  6. Attrition Rate
  7. Growth Rate
  8. Job Postings
  9. Sentiment
  10. Founders
  11. Average Tenure
  12. Average Salary
  13. Geography
  14. Keywords
  15. Skills
  16. Activities
  17. Previous Company
  18. Funding Rounds
  19. Investors
- Use real, factual, publicly available data only from the selected sources.
- Do not infer, estimate, or fabricate values.
- If a value is unavailable, unknown, or not applicable, return "N/A".
- For multi-value attributes, return a semicolon-separated string.
- Company Headcount and Job Postings should be numeric values where available.
- Hiring Rate, Attrition Rate, and Growth Rate should be returned as percentages.
- Average Salary should include the currency symbol/code where available.
- Preserve company names exactly as found in the source.

Companies ({len(entities)}):
{company_lines}

Return ONLY the JSON array."""


def build_prompt(
    entities: List[str],
    attributes: List[str],
    workflow_ids: List[str],
) -> str:
    if len(workflow_ids) == 1 and workflow_ids[0] == "labor_market":
        return build_labor_market_prompt(entities)

    source_lines_list = []
    for wf_id in workflow_ids:
        wf = WORKFLOW_SOURCES.get(wf_id)
        if wf:
            source_lines_list.append(f"  - {wf['sourceName']} ({wf['sourceUrlHint']}) \u2192 {', '.join(wf['attributes'])}")

    source_lines = "\n".join(source_lines_list)
    attr_lines = "\n".join(f"  {i + 2}. {a}" for i, a in enumerate(attributes))
    company_lines = "\n".join(f"- {c}" for c in entities)

    return f"""You are a corporate data extraction assistant. For each company below, extract the listed attributes.

Requested attributes to extract:
{attr_lines}

Selected sources (each authoritative for its listed attributes):
{source_lines or "  - (none)"}

Companies ({len(entities)}):
{company_lines}

Output rules:
- Return ONLY a valid JSON array of arrays.
- Each inner array MUST contain exactly {len(attributes) + 1} elements in this order:
  1. Company identifier (echo back exactly as provided)
{attr_lines}
- Use real, factual public data.
- If a value is unknown or not applicable, return "N/A".
- Do not infer, estimate, or fabricate values.

Return ONLY the JSON array.
"""


class GeminiFallbackService:
    """Service to handle AI extraction fallback via Lovable AI Gateway or Gemini Provider."""

    def __init__(self) -> None:
        self.gateway_url = "https://ai.gateway.lovable.dev/v1/chat/completions"
        self.default_model = "google/gemini-3-flash-preview"

    async def extract_fallback_data(
        self,
        entities: List[str],
        attributes: Optional[List[str]] = None,
        workflow_ids: Optional[List[str]] = None,
        api_key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        if not entities:
            return []

        wf_ids = [w for w in (workflow_ids or []) if w in WORKFLOW_SOURCES]
        target_attributes = (
            unique_attributes_for_workflows(wf_ids)
            if wf_ids and not attributes
            else (attributes or [])
        )

        if not target_attributes:
            target_attributes = WORKFLOW_SOURCES["company_data"]["attributes"]

        capped_entities = [str(e).strip() for e in entities if str(e).strip()][:50]
        if not capped_entities:
            return []

        prompt = build_prompt(capped_entities, target_attributes, wf_ids)
        lovable_key = api_key or os.environ.get("LOVABLE_API_KEY") or getattr(settings, "LOVABLE_API_KEY", None)
        gemini_key = os.environ.get("GEMINI_API_KEY") or getattr(settings, "GEMINI_API_KEY", None)

        if not lovable_key and not gemini_key:
            root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
            for env_path in [os.path.join(root_dir, ".env"), os.path.join(os.getcwd(), ".env"), os.path.join(os.getcwd(), "..", ".env")]:
                if os.path.exists(env_path):
                    try:
                        with open(env_path, "r", encoding="utf-8") as ef:
                            for eline in ef:
                                if eline.startswith("LOVABLE_API_KEY="):
                                    lovable_key = eline.split("=", 1)[1].strip()
                                elif eline.startswith("GEMINI_API_KEY="):
                                    gemini_key = eline.split("=", 1)[1].strip()
                    except Exception:
                        pass

        if not lovable_key and not gemini_key:
            logger.warning("No API key available for Gemini fallback extraction.")
            return []

        ai_content = ""
        # 1. Try Lovable AI Gateway if key available
        if lovable_key:
            try:
                async with httpx.AsyncClient(timeout=45.0) as client:
                    response = await client.post(
                        self.gateway_url,
                        headers={
                            "Authorization": f"Bearer {lovable_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.default_model,
                            "messages": [
                                {
                                    "role": "system",
                                    "content": "You are a corporate data extraction assistant. Always respond with valid JSON only.",
                                },
                                {"role": "user", "content": prompt},
                            ],
                            "temperature": 0.1,
                        },
                    )
                    if response.status_code == 200:
                        ai_result = response.json()
                        ai_content = ai_result.get("choices", [{}])[0].get("message", {}).get("content", "")
                    else:
                        logger.warning(f"Lovable AI Gateway status {response.status_code}: {response.text[:200]}")
            except Exception as exc:
                logger.warning(f"Lovable AI Gateway request failed: {exc}")

        # 2. Fallback to direct Google Gemini API if ai_content is empty
        if not ai_content and gemini_key:
            fallback_models = ["models/gemma-4-26b-a4b-it", "models/gemini-2.0-flash", "models/gemini-1.5-flash"]
            for model_name in fallback_models:
                try:
                    async with httpx.AsyncClient(timeout=90.0) as client:
                        g_url = f"https://generativelanguage.googleapis.com/v1beta/{model_name}:generateContent?key={gemini_key}"
                        g_resp = await client.post(
                            g_url,
                            json={
                                "contents": [
                                    {
                                        "parts": [
                                            {
                                                "text": prompt + "\nRespond ONLY with a valid JSON array of arrays."
                                            }
                                        ]
                                    }
                                ]
                            }
                        )
                        if g_resp.status_code == 200:
                            g_json = g_resp.json()
                            ai_content = g_json.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                            if ai_content:
                                logger.info(f"[Gemini Fallback] Successfully extracted data using Google Gemini model {model_name}")
                                break
                        else:
                            logger.warning(f"[Gemini Fallback] Model {model_name} returned status {g_resp.status_code}")
                except Exception as g_err:
                    logger.warning(f"[Gemini Fallback] Google Gemini model {model_name} failed: {g_err}")

        ai_items: List[Any] = []
        if ai_content:
            try:
                ai_items = _parse_ai_items(ai_content)
            except Exception as parse_err:
                logger.error(f"Failed to parse Gemini fallback JSON response: {parse_err}")

        results_by_entity: Dict[str, Dict[str, Any]] = {}
        for entity in capped_entities:
            results_by_entity[entity] = {}

        for item in ai_items:
            if isinstance(item, dict):
                key = str(item.get("company") or item.get("entity") or item.get("Company Identifier") or item.get("legal_name") or item.get("company_name") or "").strip()
                if not key:
                    continue
                extracted_dict = {k: str(v).strip() for k, v in item.items() if v not in (None, "", "N/A", "null") and str(v).strip().upper() != "N/A"}
                matched_key = next((k for k in results_by_entity if k.lower() in key.lower() or key.lower() in k.lower()), None)
                if matched_key:
                    results_by_entity[matched_key].update(extracted_dict)
                else:
                    results_by_entity[key] = extracted_dict
            elif isinstance(item, list) and len(item) > 0:
                key = str(item[0] or "").strip()
                if not key:
                    continue
                extracted_dict = {}
                for i, attr_name in enumerate(target_attributes):
                    val_idx = i + 1
                    val = item[val_idx] if val_idx < len(item) else "N/A"
                    val_str = str(val or "").strip()
                    if val_str and val_str.upper() != "N/A":
                        extracted_dict[attr_name] = val_str
                matched_key = next((k for k in results_by_entity if k.lower() == key.lower()), None)
                if matched_key:
                    results_by_entity[matched_key].update(extracted_dict)
                else:
                    results_by_entity[key] = extracted_dict

        return [
            {
                "entity": entity,
                "extracted": results_by_entity.get(entity, {}),
                "confidence": AI_FALLBACK_CONFIDENCE,
                "source": "ai_fallback",
                "filled_fields": list(results_by_entity.get(entity, {}).keys()),
            }
            for entity in capped_entities
        ]


gemini_fallback_service = GeminiFallbackService()
