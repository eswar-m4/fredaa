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

    def _normalize_token(self, value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")
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

    def _ollama_chat(self, messages: List[Dict[str, str]]) -> Dict[str, Any]:
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
            "company_name": {"company_name", "company", "name", "organization"},
            "legal_name": {"legal_name", "registered_name"},
            "hq_address": {"hq_address", "address", "headquarters_address"},
            "website_url": {"website", "website_url", "company_website", "domain", "url"},
            "email": {"email", "email_address", "work_email", "business_email"},
            "phone_number": {"phone", "phone_number", "telephone", "mobile"},
            "linkedin_url": {"linkedin", "linkedin_url", "linkedin_profile"},
            "employee_count": {"employee_count", "employees", "emp_count"},
            "industry_vertical": {"industry", "industry_vertical"},
            "country": {"country"},
            "city": {"city"},
            "state": {"state", "province"},
            "postal_code": {"postal_code", "zip", "zip_code", "pincode"},
            "cik_number": {"cik", "cik_number"},
            "sic_code": {"sic", "sic_code"},
            "sic_description": {"sic_description"},
            "state_of_incorporation": {"state_of_incorporation"},
            "fiscal_year_end": {"fiscal_year_end"},
            "funding_stage": {"funding_stage"},
            "stock_ticker": {"stock_ticker", "ticker"},
            "public_private": {"public_private"},
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
        for header in headers:
            normalized_header = self._normalize_token(header)
            if normalized_header in superset_set:
                exact_matches[header] = normalized_header
            else:
                unresolved.append(header)

        llm_trace: Dict[str, Any] = {}
        used_fallback = False
        inferred: Dict[str, str] = {}

        if unresolved:
            messages = [
                {
                    "role": "system",
                    "content": (
                        "Map each input header to exactly one field from allowed superset fields, "
                        "or empty string if no reliable mapping. Return strict JSON with key 'mappings' only."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Input headers: {unresolved}\n"
                        f"Allowed superset fields: {superset}\n"
                        "Return format: "
                        '{"mappings":[{"input_header":"...","mapped_field":"allowed_or_empty"}]}'
                    ),
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
            except Exception as exc:
                used_fallback = True
                llm_trace = {"error": str(exc)}

            for header in unresolved:
                if header in inferred:
                    continue
                guess = self._heuristic_field_map(header, superset)
                if guess:
                    inferred[header] = guess

        mappings = []
        for header in headers:
            mapped = exact_matches.get(header) or inferred.get(header) or ""
            mappings.append({
                "input_header": header,
                "mapped_field": mapped,
                "match_type": "exact" if exact_matches.get(header) else ("qwen" if mapped else "none"),
            })

        return {
            "mappings": mappings,
            "used_fallback": used_fallback,
            "llm_trace": llm_trace,
            "model": settings.OLLAMA_MODEL,
        }


website_complexity_classifier_service = WebsiteComplexityClassifierService()
