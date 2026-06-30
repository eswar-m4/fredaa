from __future__ import annotations

import json
import re
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

    def suggest_field_mappings(self, input_headers: List[str], superset_fields: List[str]) -> Dict[str, Any]:
        headers = [str(h).strip() for h in (input_headers or []) if str(h).strip()]
        superset = [self._normalize_token(f) for f in (superset_fields or []) if self._normalize_token(f)]
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

        llm_trace: Dict[str, Any] = {}
        used_fallback = False

        if unresolved:
            field_descriptions = {
                "legal_name": "Official registered company name, corporate entity name, business name, or legal name of the organization.",
                "dba": "DBA (Doing Business As), trading name, brand name, operating name, or trading style.",
                "description": "Short summary, profile, overview, business description, history, or company bio.",
                "tagline": "Slogan, marketing tagline, motto, or short catchphrase.",
                "hq_address": "Full physical headquarters street address, registered office address, head office location, legal address, or main office street address (excluding city/state/zip if they are separate columns).",
                "hq_city": "The city or municipality where the company's main headquarters or office is located.",
                "hq_state": "The state, province, territory, region, or canton of the company's headquarters.",
                "hq_country": "The country or nation of the company's headquarters.",
                "website": "Official corporate website, homepage URL, company domain, web address, or target site link.",
                "email": "Primary corporate email address, contact email, general inquiry inbox, or business email.",
                "phone": "Corporate telephone number, contact phone, business helpline, or mobile number.",
                "linkedin_url": "Official LinkedIn company page URL or corporate social profile link.",
                "employee_count": "Total headcount, staff size, number of employees, active personnel count, or employment volume.",
                "industry": "Business industry, sector, classification vertical, or primary activity type.",
                "registry_number": "Corporate registry number, registration number, company number, filing ID, or official CIK.",
                "sic_code": "Standard Industrial Classification (SIC) identifier code.",
                "naics_code": "North American Industry Classification System (NAICS) identifier code.",
                "tax_id": "Employer Identification Number (EIN), business tax registration number, or tax ID.",
                "revenue": "Annual revenue, total sales, annual turnover, or financial income bracket.",
                "valuation": "Estimated financial company valuation, worth, or market capitalization.",
                "year_founded": "The year when the company or organization was founded or incorporated."
            }

            semantic_list = []
            for field in superset:
                desc = field_descriptions.get(field)
                if not desc:
                    clean_field = field.replace("_", " ").strip()
                    desc = f"Company field representing {clean_field}."
                semantic_list.append(f"{field}\n{desc}")
            superset_semantics = "\n\n".join(semantic_list)

            examples = (
                "Here are representative examples of how input headers map to target fields:\n"
                "- 'Address-Line 1', 'Address-Line2', 'Street Address', 'Headquarters Address', 'Registered Office', 'Head Office', 'Legal Address', 'Office Address' -> hq_address\n"
                "- 'Company Name', 'Organization Name', 'Entity Name', 'Firm Name', 'Legal Entity' -> legal_name\n"
                "- 'HQ City', 'Town', 'City Location' -> hq_city\n"
                "- 'HQ State', 'Province', 'Region', 'Canton', 'State Name' -> hq_state\n"
                "- 'Zip', 'Zip Code', 'Postal Code', 'PIN Code', 'Postcode' -> zip_code\n"
                "- 'Website URL', 'Homepage', 'Domain Name', 'Web Address', 'Corp Site' -> website\n"
                "- 'Sector', 'Business Type', 'Industry Category' -> industry\n"
                "- 'Telephone', 'Corp Phone', 'Contact Number', 'Office Phone' -> phone\n"
                "- 'Contact Email', 'Gen Email', 'Inquiry Email' -> email\n"
                "- 'Employees', 'Headcount', 'Staff Size', 'Personnel' -> employee_count\n"
                "- 'Registration No', 'Company Number', 'CIK' -> registry_number"
            )

            system_content = (
                "You are an expert data classification AI assistant specializing in schema mapping.\n"
                "Your task is to map input column headers from an uploaded dataset to target fields in a predefined company database schema (superset fields).\n"
                "To ensure high accuracy, analyze the semantic meaning of the input header in the context of all dataset headers. "
                "Look past abbreviations, typos, and alternate business terminology (e.g., 'Registered Office', 'Legal Address', or 'Head Office' all refer to the company's main street address, which is 'hq_address').\n"
                "For each input header, decide on the single best target field name from the allowed list, or return an empty string if there is absolutely no semantic match.\n"
                "Provide a step-by-step reasoning in the 'reason' field explaining the synonym mapping and why it fits."
            )

            user_content = (
                f"Complete Dataset Headers for Context:\n{headers}\n\n"
                f"Allowed Superset Fields and Descriptions:\n{superset_semantics}\n\n"
                f"{examples}\n\n"
                f"Input Headers to Map:\n{unresolved}\n\n"
                "For each unresolved header, perform a semantic mapping to one of the allowed fields. "
                "Return strict JSON with mapping objects containing the following keys:\n"
                "- 'input_header': the exact string from unresolved list.\n"
                "- 'mapped_field': the matched target field name or empty string.\n"
                "- 'confidence': a float confidence score between 0.00 and 1.00.\n"
                "- 'reason': a brief explanation of why this mapping was selected.\n\n"
                "Return Format Example:\n"
                '{"mappings": [{"input_header": "Company Name", "mapped_field": "legal_name", "confidence": 0.99, "reason": "Represents the official company name."}]}'
            )

            messages = [
                {
                    "role": "system",
                    "content": system_content,
                },
                {
                    "role": "user",
                    "content": user_content,
                },
            ]
            try:
                llm_trace = self._ollama_chat(messages)
                parsed = llm_trace.get("parsed") or {}
                rows = parsed.get("mappings") if isinstance(parsed.get("mappings"), list) else []
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    header = str(row.get("input_header") or "").strip()
                    mapped = self._normalize_token(str(row.get("mapped_field") or ""))
                    if header in unresolved and mapped in superset_set:
                        inferred[header] = mapped
                        try:
                            inferred_conf[header] = float(row.get("confidence") or 0.0)
                        except Exception:
                            inferred_conf[header] = 0.0
                        inferred_reason[header] = str(row.get("reason") or "").strip()
            except Exception as exc:
                logger.warning("Ollama field mapping suggestions failed, falling back to central AIProvider: %s", exc)
                used_fallback = True
                try:
                    from app.services.ai_provider import AIProvider
                    provider = AIProvider(api_key=settings.GEMINI_API_KEY, model=settings.GEMINI_MODEL)
                    prompt = (
                        "You are an AI assistant specializing in database schema mapping. Your task is to map input column headers from an uploaded dataset "
                        "to allowed fields from the target schema (superset fields) based on semantic understanding. Map each input header to exactly one field from allowed superset fields, or an empty string if no reliable mapping exists. "
                        "You must return a strict JSON object with a single key 'mappings' only.\n\n"
                        f"Complete Dataset Headers for Context:\n{headers}\n\n"
                        f"Allowed Superset Fields and Descriptions:\n{superset_semantics}\n\n"
                        f"{examples}\n\n"
                        f"Input Headers to Map:\n{unresolved}\n\n"
                        "For each unresolved header, perform a semantic mapping to one of the allowed fields. "
                        "Return strict JSON with mapping objects containing the following keys:\n"
                        "- 'input_header': the exact string from unresolved list.\n"
                        "- 'mapped_field': the matched target field name or empty string.\n"
                        "- 'confidence': a float confidence score between 0.00 and 1.00.\n"
                        "- 'reason': a brief explanation of why this mapping was selected.\n\n"
                        "Return Format Example:\n"
                        '{"mappings": [{"input_header": "Company Name", "mapped_field": "legal_name", "confidence": 0.99, "reason": "Represents the official company name."}]}'
                    )
                    raw_response = provider.generate(prompt, timeout=settings.AI_REQUEST_TIMEOUT_SEC, temperature=0.1)
                    
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
                        header = str(row.get("input_header") or "").strip()
                        mapped = self._normalize_token(str(row.get("mapped_field") or ""))
                        if header in unresolved and mapped in superset_set:
                            inferred[header] = mapped
                            try:
                                inferred_conf[header] = float(row.get("confidence") or 0.0)
                            except Exception:
                                inferred_conf[header] = 0.0
                            inferred_reason[header] = str(row.get("reason") or "").strip()
                except Exception as fallback_exc:
                    logger.error("Fallback AIProvider mapping failed: %s", fallback_exc, exc_info=True)
                    llm_trace = {"error": str(exc), "fallback_error": str(fallback_exc)}

        mappings = []
        for header in headers:
            mapped = exact_matches.get(header) or inferred.get(header) or ""
            confidence = 1.0 if exact_matches.get(header) else inferred_conf.get(header, 0.0)
            reason = "Exact match" if exact_matches.get(header) else inferred_reason.get(header, "")
            
            mappings.append({
                "input_header": header,
                "mapped_field": mapped,
                "match_type": "exact" if exact_matches.get(header) else ("qwen" if mapped else "none"),
                "confidence": confidence,
                "reason": reason
            })

        return {
            "mappings": mappings,
            "used_fallback": used_fallback,
            "llm_trace": llm_trace,
            "model": settings.OLLAMA_MODEL,
        }


website_complexity_classifier_service = WebsiteComplexityClassifierService()
