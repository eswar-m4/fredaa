from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from time import perf_counter
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
import requests

from app.config import settings
from app.core.logger import setup_logger

logger = setup_logger(__name__)


class WebsiteComplexityClassifierService:
    def __init__(self) -> None:
        self._criteria_cache: Optional[str] = None
        self._field_mapping_cache: Dict[str, Dict[str, Any]] = {}

    def _criteria_paths(self) -> List[Path]:
        return [
            Path(settings.WEBSITE_COMPLEXITY_XLSX_PATH),
            Path("data/Website Complexity.xlsx"),
            Path(r"c:\Users\tanis\Downloads\Website Complexity.xlsx"),
        ]

    def _load_criteria_text(self) -> str:
        if self._criteria_cache:
            return self._criteria_cache
        for candidate in self._criteria_paths():
            if not candidate.exists():
                continue
            try:
                workbook = pd.ExcelFile(candidate)
                lines: List[str] = []
                for sheet in workbook.sheet_names:
                    frame = workbook.parse(sheet).fillna("")
                    if frame.empty:
                        continue
                    lines.append(f"[{sheet}]")
                    for _, row in frame.iterrows():
                        left = str(row.iloc[0]).strip()
                        right = str(row.iloc[1]).strip() if len(row) > 1 else ""
                        if left or right:
                            lines.append(f"- {left} :: {right}".strip())
                text = "\n".join(lines).strip()
                if text:
                    self._criteria_cache = text
                    return text
            except Exception as exc:
                logger.warning("Failed reading complexity workbook %s: %s", candidate, exc)
        self._criteria_cache = (
            "Simple: GET only, no login, <=1 navigation step, <10 attributes. "
            "Medium: GET/POST mix, no login, <=2 steps, <3 patterns, 10-20 attributes. "
            "Complex: POST-heavy, login, >2 steps, >3 patterns, >20 attributes. "
            "Custom: CAPTCHA/anti-bot/dynamic authentication/special handling."
        )
        return self._criteria_cache

    def _extract_json_object(self, text: str) -> Dict[str, Any]:
        content = text.strip()
        if not content:
            return {}
        try:
            return json.loads(content)
        except Exception:
            pass
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if not match:
            return {}
        try:
            return json.loads(match.group(0))
        except Exception:
            return {}

    def _normalize_token(self, value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")

    def _field_mapping_cache_key(self, input_headers: List[str], superset_fields: List[str]) -> str:
        payload = {
            "input_headers": [self._normalize_token(header) for header in input_headers],
            "superset_fields": [self._normalize_token(field) for field in superset_fields],
        }
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha1(blob.encode("utf-8")).hexdigest()

    def _ollama_chat(self, messages: List[Dict[str, str]]) -> Dict[str, Any]:
        # Preflight check: verify if local Ollama port is open and responsive (1.5s timeout)
        try:
            requests.get(settings.OLLAMA_BASE_URL, timeout=1.5)
        except Exception as conn_err:
            logger.warning("Ollama pre-flight check failed (offline or unresponsive): %s", conn_err)
            raise ConnectionError(f"Ollama is offline or unresponsive: {conn_err}")

        url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
        request_payload = {
            "model": settings.OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1},
        }
        response = requests.post(url, json=request_payload, timeout=max(120, settings.AI_REQUEST_TIMEOUT_SEC))
        response.raise_for_status()
        raw = response.json()
        content = (raw.get("message") or {}).get("content") or ""
        parsed = self._extract_json_object(content)
        return {
            "request": request_payload,
            "raw_response": raw,
            "parsed": parsed,
        }

    def _turnaround_hours(self, complexity: str) -> int:
        level = str(complexity or "").strip().lower()
        if level == "simple":
            return 6
        if level == "medium":
            return 12
        if level == "complex":
            return 32
        return 0

    def _complexity_popup(self, complexity: str) -> str:
        level = str(complexity or "").strip().lower()
        if level == "simple":
            return "Estimated completion time: 4–8 hours"
        if level == "medium":
            return "Estimated completion time: 1–2 business days"
        if level == "complex":
            return "Estimated completion time: 3–5 business days"
        return "Custom assessment required. Team will review and provide timeline."

    def _heuristic_complexity(self, source_url: str, source_name: str, notes: str, fields: List[str]) -> Dict[str, Any]:
        text = " ".join([source_url or "", source_name or "", notes or ""]).lower()
        if any(token in text for token in ["captcha", "cloudflare", "anti bot", "anti-bot", "otp", "2fa"]):
            level = "Custom"
            reasoning = "Detected anti-bot or authentication markers in source details."
            confidence = 84
        elif any(token in text for token in ["login", "signin", "portal", "auth"]):
            level = "Complex"
            reasoning = "Detected login/authenticated portal signals; likely multi-step access."
            confidence = 79
        elif len(fields or []) > 3:
            level = "Medium"
            reasoning = "Multiple requested fields suggest moderate extraction complexity."
            confidence = 70
        else:
            level = "Simple"
            reasoning = "No authentication or anti-bot indicators and small extraction scope."
            confidence = 66
        return {
            "complexity": level,
            "confidence": confidence,
            "reasoning": reasoning,
            "estimated_turnaround_hours": self._turnaround_hours(level),
            "popup_message": self._complexity_popup(level),
        }

    def classify_source(
        self,
        source_url: str = "",
        source_name: str = "",
        notes: str = "",
        selected_fields: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        fields = [str(field).strip() for field in (selected_fields or []) if str(field).strip()]
        criteria_text = self._load_criteria_text()
        messages = [
            {
                "role": "system",
                "content": (
                    "You classify website extraction complexity using only these levels: "
                    "Simple, Medium, Complex, Custom. "
                    "Return strict JSON keys: complexity, confidence, reasoning. "
                    "confidence must be integer 0-100."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Source name: {source_name}\n"
                    f"Source URL: {source_url}\n"
                    f"Notes: {notes}\n"
                    f"Selected fields: {fields}\n\n"
                    f"Criteria source:\n{criteria_text}"
                ),
            },
        ]
        used_fallback = False
        llm_trace: Dict[str, Any] = {}
        heuristic = self._heuristic_complexity(source_url, source_name, notes, fields)
        try:
            llm_trace = self._ollama_chat(messages)
            parsed = llm_trace.get("parsed") or {}
            complexity = str(parsed.get("complexity") or "").strip().title()
            if complexity not in {"Simple", "Medium", "Complex", "Custom"}:
                raise ValueError("Invalid complexity from model")
            confidence = int(max(0, min(100, int(parsed.get("confidence", 0)))))
            reasoning = str(parsed.get("reasoning") or "").strip() or "Model response did not include detailed reasoning."
            rank = {"Simple": 1, "Medium": 2, "Complex": 3, "Custom": 4}
            heuristic_level = str(heuristic.get("complexity") or "Simple")
            if rank.get(heuristic_level, 1) > rank.get(complexity, 1):
                complexity = heuristic_level
                confidence = max(confidence, int(heuristic.get("confidence") or 0))
                reasoning = f"{reasoning} Guardrail override: {heuristic.get('reasoning')}"
            result = {
                "complexity": complexity,
                "confidence": confidence,
                "reasoning": reasoning,
                "estimated_turnaround_hours": self._turnaround_hours(complexity),
                "popup_message": self._complexity_popup(complexity),
            }
        except Exception as exc:
            used_fallback = True
            logger.warning("Ollama complexity classification fallback: %s", exc)
            result = heuristic
            llm_trace = {"error": str(exc), "request": {"model": settings.OLLAMA_MODEL, "messages": messages}}
        return {
            **result,
            "llm_trace": llm_trace,
            "used_fallback": used_fallback,
            "model": settings.OLLAMA_MODEL,
        }

    def _heuristic_workflows(self, selected_fields: List[str]) -> Dict[str, Any]:
        normalized = [str(field).strip().lower().replace(" ", "_") for field in selected_fields]
        recommendations: List[str] = []
        reasons: Dict[str, str] = {}
        if any(field in {"website", "website_url", "domain", "homepage"} for field in normalized):
            recommendations.append("Website Verification")
            reasons["Website Verification"] = "Website/domain fields requested."
        if any(field in {"email", "phone_number", "phone", "linkedin_url", "contact_email"} for field in normalized):
            recommendations.append("Contact Enrichment")
            reasons["Contact Enrichment"] = "Contact channels requested."
        if any(field in {"hq_address", "address", "registered_address"} for field in normalized):
            recommendations.append("Registry Validation")
            reasons["Registry Validation"] = "Address/registry fields requested."
        if not recommendations:
            recommendations = ["Website Verification"]
            reasons["Website Verification"] = "Default recommendation for general company verification."
        return {"recommended_workflows": recommendations, "reasons": reasons}

    def recommend_workflows(self, selected_fields: Optional[List[str]] = None) -> Dict[str, Any]:
        fields = [str(field).strip() for field in (selected_fields or []) if str(field).strip()]
        messages = [
            {
                "role": "system",
                "content": (
                    "Recommend workflows from this exact set only: "
                    "Website Verification, Contact Enrichment, Registry Validation. "
                    "Return strict JSON keys: recommended_workflows (array), reasons (object string->string)."
                ),
            },
            {"role": "user", "content": f"Selected fields: {fields}"},
        ]
        used_fallback = False
        llm_trace: Dict[str, Any] = {}
        try:
            llm_trace = self._ollama_chat(messages)
            parsed = llm_trace.get("parsed") or {}
            recommendations = [
                value for value in (parsed.get("recommended_workflows") or [])
                if value in {"Website Verification", "Contact Enrichment", "Registry Validation"}
            ]
            if not recommendations:
                raw_content = str((llm_trace.get("raw_response") or {}).get("message", {}).get("content") or "").lower()
                if "website verification" in raw_content:
                    recommendations.append("Website Verification")
                if "contact enrichment" in raw_content:
                    recommendations.append("Contact Enrichment")
                if "registry validation" in raw_content:
                    recommendations.append("Registry Validation")
            reasons = parsed.get("reasons") if isinstance(parsed.get("reasons"), dict) else {}
            if not recommendations:
                raise ValueError("No valid workflow recommendations")
            result = {"recommended_workflows": recommendations, "reasons": reasons}
        except Exception as exc:
            used_fallback = True
            logger.warning("Ollama workflow recommendation fallback: %s", exc)
            result = self._heuristic_workflows(fields)
            llm_trace = {"error": str(exc), "request": {"model": settings.OLLAMA_MODEL, "messages": messages}}
        return {
            **result,
            "llm_trace": llm_trace,
            "used_fallback": used_fallback,
            "model": settings.OLLAMA_MODEL,
        }

    def analyze_preflight(
        self,
        source_url: str = "",
        source_name: str = "",
        notes: str = "",
        selected_fields: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        complexity = self.classify_source(
            source_url=source_url,
            source_name=source_name,
            notes=notes,
            selected_fields=selected_fields,
        )
        workflows = self.recommend_workflows(selected_fields=selected_fields)
        return {
            "classification": complexity,
            "workflow_recommendations": workflows,
        }

    def _heuristic_field_map(self, header: str, superset_fields: List[str]) -> str:
        key = self._normalize_token(header)
        supported = set(superset_fields)
        rules = {
            "legal_name": {"legal_name", "registered_name", "company_name", "company", "name", "organization", "firm_name", "business_name"},
            "dba": {"dba", "trading_name", "doing_business_as"},
            "description": {"description", "desc", "about", "summary"},
            "tagline": {"tagline", "slogan"},
            "hq_address": {"hq_address", "address", "headquarters_address", "add", "registered_address", "street_address", "hq_addr", "addr"},
            "hq_city": {"hq_city", "city", "hq_town", "town", "location_city"},
            "hq_state": {"hq_state", "state", "province", "hq_province", "region", "location_state"},
            "hq_country": {"hq_country", "country", "hq_nation", "nation", "location_country"},
            "website": {"website", "website_url", "company_website", "domain", "url", "corp_site", "homepage", "web_address"},
            "email": {"email", "email_address", "work_email", "business_email", "contact_email", "gen_email"},
            "phone": {"phone", "phone_number", "telephone", "mobile", "ph", "tel", "contact_number"},
            "linkedin_url": {"linkedin", "linkedin_url", "linkedin_profile", "linkedin_link"},
            "employee_count": {"employee_count", "employees", "emp_count", "headcount", "staff_count", "no_of_employees"},
            "industry": {"industry", "industry_vertical", "sector", "business_type"},
            "registry_number": {"registry_number", "cik", "cik_number", "registration_number", "company_number", "company_no", "reg_no"},
            "sic_code": {"sic", "sic_code"},
            "tax_id": {"tax_id", "ein", "tax_number", "tax_no"},
        }
        for target, aliases in rules.items():
            if target in supported and key in aliases:
                return target
        return ""

    def _compact_field_catalog(self, unresolved_headers: List[str], superset_fields: List[str], remaining_superset: List[str]) -> List[str]:
        """
        Build a smaller but semantically relevant field catalog for the LLM.

        This preserves the current mapping behavior while avoiding sending the
        full schema vocabulary when only a few headers need AI help.
        """
        headers_blob = " ".join(unresolved_headers).lower()
        groups = [
            (
                ["address", "street", "office", "headquarters", "head office", "registered", "legal address", "suite", "line1", "line2", "line 1", "line 2"],
                ["hq_address", "address", "address_2", "registered_address", "mailing_address", "office_locations"],
            ),
            (
                ["city", "town", "locality"],
                ["hq_city", "city"],
            ),
            (
                ["state", "province", "region", "canton"],
                ["hq_state", "state"],
            ),
            (
                ["country", "nation"],
                ["hq_country", "country"],
            ),
            (
                ["zip", "postal", "postcode", "pin code", "pin", "zipcode", "zip code"],
                ["zip_code", "postal_code", "zip"],
            ),
            (
                ["name", "organization", "entity", "firm", "company"],
                ["legal_name", "dba"],
            ),
        ]

        selected: List[str] = []
        for keywords, candidates in groups:
            if any(keyword in headers_blob for keyword in keywords):
                for candidate in candidates:
                    if candidate in remaining_superset and candidate not in selected:
                        selected.append(candidate)

        if not selected:
            return remaining_superset

        general_context = ["description", "industry", "website", "email", "phone", "registry_number", "tax_id"]
        for field in general_context:
            if field in remaining_superset and field not in selected:
                selected.append(field)

        return [field for field in selected if field in superset_fields]

    def suggest_field_mappings(self, input_headers: List[str], superset_fields: List[str]) -> Dict[str, Any]:
        total_start = perf_counter()
        headers = [str(h).strip() for h in (input_headers or []) if str(h).strip()]
        superset = [self._normalize_token(f) for f in (superset_fields or []) if self._normalize_token(f)]
        cache_key = self._field_mapping_cache_key(headers, superset)
        cached_response = self._field_mapping_cache.get(cache_key)
        if cached_response is not None:
            logger.info(
                "FIELD MAPPING CACHE HIT: headers=%s superset=%s mappings=%s",
                len(headers),
                len(superset),
                len(cached_response.get("mappings") or []),
            )
            return deepcopy(cached_response)

        superset_set = set(superset)
        exact_matches: Dict[str, str] = {}
        unresolved: List[str] = []
        inferred: Dict[str, str] = {}
        inferred_conf: Dict[str, float] = {}
        inferred_reason: Dict[str, str] = {}

        for header in headers:
            normalized_header = self._normalize_token(header)
            if normalized_header in superset_set:
                exact_matches[header] = normalized_header
            else:
                guess = self._heuristic_field_map(header, superset)
                if guess:
                    inferred[header] = guess
                else:
                    unresolved.append(header)

        stage_exact_heuristic_ms = (perf_counter() - total_start) * 1000.0
        llm_trace: Dict[str, Any] = {}
        used_fallback = False

        if unresolved:
            prompt_prep_start = perf_counter()
            taken_targets = set(exact_matches.values()) | set(inferred.values())
            remaining_superset = [f for f in superset if f not in taken_targets]

            field_descriptions = {
                "legal_name": "Official registered company name.",
                "dba": "Doing Business As or trading name.",
                "description": "Company profile or business summary.",
                "tagline": "Marketing tagline or slogan.",
                "logo_url": "Official logo URL.",
                "year_founded": "Year the company was founded or incorporated.",
                "company_type": "Public, private, non-profit, or partnership.",
                "ownership": "Ownership or listing status.",
                "industry": "Business industry or sector.",
                "sub_industry": "Secondary industry or niche.",
                "sic_code": "SIC code.",
                "naics_code": "NAICS code.",
                "tags": "Business tags or keywords.",
                "employee_count": "Number of employees or headcount.",
                "employee_range": "Employee size range.",
                "headcount_growth_yoy": "Year-over-year headcount growth.",
                "annual_revenue": "Annual revenue.",
                "revenue_range": "Revenue range.",
                "ebitda": "EBITDA.",
                "funding_total": "Total funding raised.",
                "latest_round": "Latest funding round.",
                "latest_round_amount": "Latest funding round amount.",
                "valuation": "Valuation.",
                "investors": "Investors.",
                "ceo_name": "CEO name.",
                "ceo_email": "CEO email.",
                "ceo_linkedin": "CEO LinkedIn URL.",
                "cfo_name": "CFO name.",
                "cto_name": "CTO name.",
                "executives": "Executive team.",
                "board_members": "Board members.",
                "hq_address": "Street address of the headquarters or main office.",
                "hq_city": "City of the headquarters or main office.",
                "hq_state": "State or region of the headquarters or main office.",
                "hq_country": "Country of the headquarters or main office.",
                "office_locations": "Additional office locations.",
                "address": "Generic street address.",
                "address_2": "Secondary address line.",
                "registered_address": "Registered corporate street address.",
                "mailing_address": "Postal mailing address.",
                "city": "Generic city.",
                "state": "Generic state or region.",
                "country": "Generic country.",
                "zip": "Postal code or ZIP.",
                "postal_code": "Postal code or postcode.",
                "zip_code": "Postal code or ZIP.",
                "website": "Official website URL.",
                "linkedin_url": "Official LinkedIn URL.",
                "twitter_url": "Official X / Twitter URL.",
                "facebook_url": "Official Facebook URL.",
                "phone": "Corporate phone number.",
                "email": "Corporate email address.",
                "registry_number": "Company registration number.",
                "lei": "Legal Entity Identifier.",
                "vat_number": "VAT registration number.",
                "tax_id": "Tax ID or EIN.",
            }

            prompt_fields = self._compact_field_catalog(unresolved, superset, remaining_superset)
            semantic_list = []
            for field in prompt_fields:
                desc = field_descriptions.get(field) or f"Company field representing {field.replace('_', ' ')}."
                status = "AVAILABLE for mapping" if field in remaining_superset else "ALREADY MAPPED (Do not map to this)"
                semantic_list.append(f"- {field} ({status}): {desc}")
            superset_semantics = "\n".join(semantic_list)

            system_content = (
                "You are a schema mapping assistant.\n"
                "Map unresolved dataset headers to one of the allowed fields using semantic similarity.\n"
                "Return strict JSON only with a single key 'mappings'.\n"
                "Only use fields present in the allowed list.\n"
                "Rules: Address-Line, Street, Registered Office, Head Office, Legal Address, Office Address, and HQ Address map to hq_address. "
                "Address-Line2 maps only to address_2 when that field is allowed; otherwise return an empty mapping. "
                "City/Town/Locality map to hq_city. State/Province/Region/Canton map to hq_state. "
                "Zip Code/Postal Code/PIN/Postcode/Zip map only to zip_code, postal_code, or zip when one of those fields is allowed; otherwise return an empty mapping. "
                "Never map postal/ZIP headers to hq_address."
            )

            user_content = (
                "Allowed Superset Fields and Descriptions:\n"
                f"{superset_semantics}\n\n"
                "Synonym Hints:\n"
                "- Company Name -> legal_name\n"
                "- Address-Line 1 / Street / Registered Office / Head Office / Legal Address / Office Address / HQ Address / Headquarters -> hq_address\n"
                "- Address-Line2 -> address_2 only if that field is allowed; otherwise empty\n"
                "- City / Town / Locality -> hq_city\n"
                "- State / Province / Region / Canton -> hq_state\n"
                "- Zip Code / Postal Code / PIN / Postcode / Zip -> zip_code, postal_code, or zip only if one of those fields is allowed; otherwise empty\n\n"
                "Input Headers to Map:\n"
                f"{unresolved}\n\n"
                "For each unresolved header, return one mapping object with these keys:\n"
                "- 'input_header': the exact string from unresolved list.\n"
                "- 'mapped_field': the matched target field name (from allowed superset fields only) or empty string.\n"
                "- 'confidence': a float confidence score between 0.00 and 1.00.\n"
                "- 'reason': a brief explanation of why this mapping was selected.\n\n"
                "Return Format Example:\n"
                '{"mappings": [{"input_header": "Company Name", "mapped_field": "legal_name", "confidence": 0.99, "reason": "Conceptually represents the official company name."}]}'
            )

            prompt_prep_ms = (perf_counter() - prompt_prep_start) * 1000.0
            messages = [
                {"role": "system", "content": system_content},
                {"role": "user", "content": user_content},
            ]

            logger.info("=== FIELD MAPPING PIPELINE TRACE - START ===")
            logger.info(
                "FIELD MAPPING PROMPT STAGES: exact_heuristic_ms=%.2f prompt_prep_ms=%.2f prompt_chars=%s unresolved=%s prompt_fields=%s",
                stage_exact_heuristic_ms,
                prompt_prep_ms,
                len(system_content) + len(user_content),
                len(unresolved),
                len(prompt_fields),
            )

            try:
                llm_start = perf_counter()
                llm_trace = self._ollama_chat(messages)
                llm_ms = (perf_counter() - llm_start) * 1000.0
                raw_response = llm_trace.get("raw_response") or {}
                parsed = llm_trace.get("parsed") or {}
                logger.info(
                    "FIELD MAPPING LLM STAGES: request_ms=%.2f prompt_eval_ms=%s eval_ms=%s model=%s",
                    llm_ms,
                    raw_response.get("prompt_eval_duration"),
                    raw_response.get("eval_duration"),
                    raw_response.get("model"),
                )

                parse_start = perf_counter()
                rows = parsed.get("mappings") if isinstance(parsed.get("mappings"), list) else []
                parse_ms = (perf_counter() - parse_start) * 1000.0
                logger.info("FIELD MAPPING PARSE STAGE: parse_ms=%.2f rows=%s", parse_ms, len(rows))

                validation_start = perf_counter()
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    header_raw = str(row.get("input_header") or "").strip()
                    mapped_raw = str(row.get("mapped_field") or "").strip()

                    normalized_header = self._normalize_token(header_raw)
                    mapped = self._normalize_token(mapped_raw)

                    matched_header = next((h for h in unresolved if self._normalize_token(h) == normalized_header), None)

                    is_unresolved = matched_header is not None
                    is_superset = mapped in superset_set
                    logger.info(
                        "VALIDATING SUGGESTION: HeaderRaw='%s' (Matched='%s') -> MappedFieldRaw='%s' (Normalized='%s') | InUnresolved=%s, InSuperset=%s",
                        header_raw, matched_header, mapped_raw, mapped, is_unresolved, is_superset
                    )

                    if is_unresolved and is_superset:
                        inferred[matched_header] = mapped
                        try:
                            inferred_conf[matched_header] = float(row.get("confidence") or 0.0)
                        except Exception:
                            inferred_conf[matched_header] = 0.0
                        inferred_reason[matched_header] = str(row.get("reason") or "").strip()
                    else:
                        logger.info("DISCARDING SUGGESTION: Header='%s' -> MappedField='%s' (Validation failed)", header_raw, mapped)
                validation_ms = (perf_counter() - validation_start) * 1000.0
                logger.info("FIELD MAPPING VALIDATION STAGE: validation_ms=%.2f", validation_ms)
            except Exception as exc:
                logger.warning("Ollama field mapping suggestions failed, falling back to central AIProvider: %s", exc)
                used_fallback = True
                try:
                    from app.services.ai_provider import AIProvider
                    provider = AIProvider(api_key=settings.GEMINI_API_KEY, model=settings.GEMINI_MODEL)
                    raw_response = provider.generate(f"{system_content}\n\n{user_content}", timeout=settings.AI_REQUEST_TIMEOUT_SEC, temperature=0.1)

                    cleaned = raw_response.strip()
                    if cleaned.startswith("```json"):
                        cleaned = cleaned[7:]
                    if cleaned.startswith("```"):
                        cleaned = cleaned[3:]
                    if cleaned.endswith("```"):
                        cleaned = cleaned[:-3]

                    parsed = json.loads(cleaned.strip())
                    llm_trace = {"provider": "central_ai_provider", "raw_response": raw_response, "parsed": parsed}

                    rows = parsed.get("mappings") if isinstance(parsed.get("mappings"), list) else []
                    for row in rows:
                        if not isinstance(row, dict):
                            continue
                        header_raw = str(row.get("input_header") or "").strip()
                        mapped_raw = str(row.get("mapped_field") or "").strip()

                        normalized_header = self._normalize_token(header_raw)
                        mapped = self._normalize_token(mapped_raw)

                        matched_header = next((h for h in unresolved if self._normalize_token(h) == normalized_header), None)

                        is_unresolved = matched_header is not None
                        is_superset = mapped in superset_set

                        if is_unresolved and is_superset:
                            inferred[matched_header] = mapped
                            try:
                                inferred_conf[matched_header] = float(row.get("confidence") or 0.0)
                            except Exception:
                                inferred_conf[matched_header] = 0.0
                            inferred_reason[matched_header] = str(row.get("reason") or "").strip()
                except Exception as fallback_exc:
                    logger.error("Fallback AIProvider mapping failed: %s", fallback_exc, exc_info=True)
                    llm_trace = {"error": str(exc), "fallback_error": str(fallback_exc)}

        response_start = perf_counter()
        mappings = []
        for header in headers:
            mapped = exact_matches.get(header) or inferred.get(header) or ""
            if exact_matches.get(header):
                confidence = 1.0
                reason = "Exact match"
            elif header in inferred and header not in unresolved:
                confidence = 0.95
                reason = "Heuristic match based on standard naming patterns."
            else:
                confidence = inferred_conf.get(header, 0.0)
                reason = inferred_reason.get(header, "")

            mappings.append({
                "input_header": header,
                "mapped_field": mapped,
                "match_type": "exact" if exact_matches.get(header) else ("qwen" if mapped else "none"),
                "confidence": confidence,
                "reason": reason
            })
        response_ms = (perf_counter() - response_start) * 1000.0
        total_ms = (perf_counter() - total_start) * 1000.0

        logger.info(
            "FIELD MAPPING RESPONSE STAGE: response_ms=%.2f total_ms=%.2f mappings=%s",
            response_ms,
            total_ms,
            len(mappings),
        )
        logger.info("FINAL API RESPONSE RETURNED TO FRONTEND:\n%s", json.dumps(mappings, indent=2))
        logger.info("=== FIELD MAPPING PIPELINE TRACE - END ===")

        result = {
            "mappings": mappings,
            "used_fallback": used_fallback,
            "llm_trace": llm_trace,
            "model": settings.OLLAMA_MODEL,
        }
        self._field_mapping_cache[cache_key] = deepcopy(result)
        return result

website_complexity_classifier_service = WebsiteComplexityClassifierService()
