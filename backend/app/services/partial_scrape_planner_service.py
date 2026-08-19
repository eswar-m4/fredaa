"""
Heuristic planner for By Source partial scrape requests.

This service only interprets natural language into a structured execution plan.
It never crawls or scrapes content itself.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List

from app.core.logger import setup_logger
from app.models.partial_scrape_schemas import (
    PartialScrapeExecutionPlan,
    PartialScrapePlanFeedback,
    PartialScrapePlanResult,
    PartialScrapePlannerMetadata,
)
from app.services.partial_scrape_capabilities import (
    all_partial_scrape_capabilities,
    canonicalize_field,
    get_partial_scrape_capability,
    normalize_source_key,
)

logger = setup_logger(__name__)

PLANNER_VERSION = "partial-scrape-planner-v1"


class PartialScrapePlannerService:
    def __init__(self) -> None:
        self._capabilities = {cap.source_key: cap for cap in all_partial_scrape_capabilities()}

    def plan_partial_scrape(
        self,
        *,
        source_name: str,
        user_request: str,
    ) -> PartialScrapePlanResult:
        source_key = normalize_source_key(source_name)
        capability = get_partial_scrape_capability(source_name)
        if capability is None:
            # Fall back to a generic field-filter capability if a source has not been registered yet.
            capability = get_partial_scrape_capability(source_key)
            if capability is None:
                if self._capabilities:
                    capability = next(iter(self._capabilities.values()))
                else:
                    from app.services.partial_scrape_capabilities import PartialScrapeCapability
                    capability = PartialScrapeCapability(
                        source_key=source_key,
                        source_name=source_name,
                        adapter_kind="field_filter",
                        supported_fields=[],
                    )

        request_text = (user_request or "").strip()
        if not request_text:
            feedback = PartialScrapePlanFeedback(
                status="needs_clarification",
                execution_summary="No partial scrape instructions were provided.",
                explanation="A natural-language request is required to build a partial scrape plan.",
                clarification_required=["Describe what should be scraped, including any filters or limits."],
                unsupported_reason=None,
            )
            plan = self._build_empty_plan(capability.source_name, capability.source_key, "")
            return PartialScrapePlanResult(
                planner_metadata=self._build_metadata(confidence=0.0),
                feedback=feedback,
                execution_plan=plan,
            )

        heuristic = self._heuristic_plan(capability, request_text)
        merged = self._merge_plan(capability, request_text, heuristic)
        merged["planner_metadata"]["provider_used"] = "heuristic"
        merged["planner_metadata"]["model_name"] = "heuristic"
        return PartialScrapePlanResult(
            planner_metadata=PartialScrapePlannerMetadata(**merged["planner_metadata"]),
            feedback=PartialScrapePlanFeedback(**merged["feedback"]),
            execution_plan=PartialScrapeExecutionPlan(**merged["execution_plan"]),
        )

    def _build_metadata(self, *, confidence: float) -> Dict[str, Any]:
        return {
            "planner_version": PLANNER_VERSION,
            "planned_at": datetime.utcnow(),
            "confidence": max(0.0, min(1.0, float(confidence))),
            "model_name": "heuristic",
            "provider_used": "heuristic",
        }

    def _build_empty_plan(self, source_name: str, source_key: str, raw_request: str) -> PartialScrapeExecutionPlan:
        return PartialScrapeExecutionPlan(
            source_name=source_name,
            source_key=source_key,
            raw_request=raw_request,
            normalized_request="",
            execution_strategy="field_filter",
            supported_filters={},
            include_terms=[],
            exclude_terms=[],
            url_hints=[],
            file_types=[],
            crawl_limits={},
            unsupported_constraints=[],
            clarification_required=[],
            adapter_kind="field_filter",
            adapter_payload={"filters": {}},
        )

    def _heuristic_plan(self, capability, request_text: str) -> Dict[str, Any]:
        text = request_text.strip()
        lower = text.lower()
        supported_filters: Dict[str, Any] = {}
        include_terms: List[str] = []
        exclude_terms: List[str] = []
        url_hints = re.findall(r"https?://[^\s,]+|www\.[^\s,]+", text, flags=re.I)
        file_types = [ft for ft in ["pdf", "csv", "xlsx", "xls", "json", "html", "docx"] if re.search(rf"\b{re.escape(ft)}\b", lower)]
        crawl_limits: Dict[str, Any] = {}
        unsupported_constraints: List[str] = []
        clarification_required: List[str] = []

        field_patterns = self._field_patterns(capability.source_key)
        for field, patterns in field_patterns.items():
            values: List[str] = []
            for pattern, canonical in patterns:
                match = re.search(pattern, lower, flags=re.I)
                if not match:
                    continue
                resolved = canonical(match) if callable(canonical) else canonical
                if resolved not in values:
                    values.append(str(resolved).strip())
            if values:
                supported_filters[field] = values if len(values) > 1 else values[0]

        keyword_terms = self._extract_keywords(lower)
        include_terms.extend(keyword_terms["include"])
        exclude_terms.extend(keyword_terms["exclude"])

        if "starting url" in lower or "start url" in lower or url_hints:
            if capability.supports_url_hints:
                crawl_limits["seed_urls"] = url_hints
            else:
                unsupported_constraints.append("starting URL or page hints are not directly supported by this bot")

        if any(token in lower for token in ["last 7 days", "last 30 days", "date range", "between ", "from ", "after ", "before "]):
            if capability.supports_date_ranges:
                crawl_limits["date_range"] = self._extract_date_range(lower)
            else:
                unsupported_constraints.append("date filters are not directly supported by this bot")

        if any(token in lower for token in ["pdf", "csv", "xlsx", "xls", "docx", "json", "html"]):
            if capability.supports_file_types:
                crawl_limits["file_types"] = file_types
            else:
                unsupported_constraints.append("file type limits are not directly supported by this bot")

        if any(token in lower for token in ["max depth", "crawl depth", "first ", "limit ", "only first", "up to "]):
            if capability.supports_crawl_limits:
                crawl_limits["crawl_limit"] = self._extract_crawl_limit(lower)
            else:
                unsupported_constraints.append("crawl limits are not directly supported by this bot")

        if any(token in lower for token in ["or ", "maybe ", "either ", "unsure", "whatever", "something like"]):
            clarification_required.append("Confirm the exact subset if multiple interpretations are possible.")

        status = self._resolve_status(supported_filters, unsupported_constraints, clarification_required, lower)
        summary = self._build_summary(capability.source_name, supported_filters, include_terms, exclude_terms, unsupported_constraints)
        confidence = self._heuristic_confidence(supported_filters, unsupported_constraints, clarification_required)
        return {
            "status": status,
            "summary": summary,
            "confidence": confidence,
            "normalized_request": summary,
            "supported_filters": supported_filters,
            "include_terms": list(dict.fromkeys(include_terms)),
            "exclude_terms": list(dict.fromkeys(exclude_terms)),
            "url_hints": list(dict.fromkeys(url_hints)),
            "file_types": list(dict.fromkeys(file_types)),
            "crawl_limits": crawl_limits,
            "unsupported_constraints": list(dict.fromkeys(unsupported_constraints)),
            "clarification_required": list(dict.fromkeys(clarification_required)),
            "execution_strategy": capability.adapter_kind,
            "explanation": "",
            "unsupported_reason": None,
        }

    def _field_patterns(self, source_key: str) -> Dict[str, List[tuple[str, str]]]:
        return {}

    def _extract_keywords(self, lower: str) -> Dict[str, List[str]]:
        include: List[str] = []
        exclude: List[str] = []
        keyword_patterns = [
            r"keywords?:\s*([^.;]+)",
            r"include(?: only)?\s+([^.;]+)",
            r"exclude(?: any)?\s+([^.;]+)",
        ]
        for pattern in keyword_patterns:
            for match in re.finditer(pattern, lower, flags=re.I):
                text = match.group(1).strip()
                if "exclude" in pattern:
                    exclude.extend([t.strip(" ,") for t in re.split(r"[,/|]", text) if t.strip()])
                else:
                    include.extend([t.strip(" ,") for t in re.split(r"[,/|]", text) if t.strip()])
        return {
            "include": [t for t in include if t],
            "exclude": [t for t in exclude if t],
        }

    def _extract_date_range(self, lower: str) -> Dict[str, Any]:
        return {"raw": lower}

    def _extract_crawl_limit(self, lower: str) -> Dict[str, Any]:
        match = re.search(r"(?:first|limit|up to)\s+(\d+)", lower)
        if match:
            return {"max_items": int(match.group(1))}
        return {"raw": lower}

    def _resolve_status(
        self,
        supported_filters: Dict[str, Any],
        unsupported_constraints: List[str],
        clarification_required: List[str],
        lower: str,
    ) -> str:
        if clarification_required:
            return "needs_clarification"
        if supported_filters:
            return "supported"
        if unsupported_constraints:
            return "unsupported"
        if len(lower.split()) < 4:
            return "needs_clarification"
        return "unsupported"

    def _build_summary(
        self,
        source_name: str,
        supported_filters: Dict[str, Any],
        include_terms: List[str],
        exclude_terms: List[str],
        unsupported_constraints: List[str],
    ) -> str:
        parts: List[str] = [f"Planned partial scrape for {source_name}"]
        if supported_filters:
            parts.append(f"with filters {supported_filters}")
        if include_terms:
            parts.append(f"including terms {include_terms}")
        if exclude_terms:
            parts.append(f"excluding terms {exclude_terms}")
        if unsupported_constraints:
            parts.append(f"unsupported: {unsupported_constraints}")
        return "; ".join(parts)

    def _heuristic_confidence(
        self,
        supported_filters: Dict[str, Any],
        unsupported_constraints: List[str],
        clarification_required: List[str],
    ) -> float:
        score = 0.45
        score += min(0.4, 0.1 * len(supported_filters))
        score -= min(0.2, 0.05 * len(unsupported_constraints))
        score -= min(0.2, 0.08 * len(clarification_required))
        return max(0.05, min(0.95, score))

    def _merge_plan(
        self,
        capability,
        request_text: str,
        heuristic: Dict[str, Any],
    ) -> Dict[str, Any]:
        base = dict(heuristic)
        supported_filters = self._canonicalize_supported_filters(capability.source_key, base.get("supported_filters") or {})
        include_terms = self._string_list(base.get("include_terms"))
        exclude_terms = self._string_list(base.get("exclude_terms"))
        url_hints = self._string_list(base.get("url_hints"))
        file_types = self._string_list(base.get("file_types"))
        crawl_limits = base.get("crawl_limits") if isinstance(base.get("crawl_limits"), dict) else {}
        unsupported_constraints = self._string_list(base.get("unsupported_constraints"))
        clarification_required = self._string_list(base.get("clarification_required"))
        status = str(base.get("status") or heuristic["status"]).strip().lower()
        if status not in {"supported", "needs_clarification", "unsupported"}:
            status = heuristic["status"]

        if supported_filters and status == "unsupported":
            status = "supported"
        if not supported_filters and not clarification_required and status == "supported":
            status = "needs_clarification" if not unsupported_constraints else "unsupported"

        normalized_request = str(base.get("normalized_request") or base.get("summary") or "").strip()
        if not normalized_request:
            normalized_request = self._build_summary(
                capability.source_name,
                supported_filters,
                include_terms,
                exclude_terms,
                unsupported_constraints,
            )

        execution_plan = {
            "source_name": capability.source_name,
            "source_key": capability.source_key,
            "raw_request": request_text,
            "normalized_request": normalized_request,
            "execution_strategy": str(base.get("execution_strategy") or capability.adapter_kind),
            "supported_filters": supported_filters,
            "include_terms": include_terms,
            "exclude_terms": exclude_terms,
            "url_hints": url_hints,
            "file_types": file_types,
            "crawl_limits": crawl_limits if isinstance(crawl_limits, dict) else {},
            "unsupported_constraints": unsupported_constraints,
            "clarification_required": clarification_required,
            "adapter_kind": capability.adapter_kind,
            "adapter_payload": {
                "filters": supported_filters,
                "include_terms": include_terms,
                "exclude_terms": exclude_terms,
                "url_hints": url_hints,
                "file_types": file_types,
                "crawl_limits": crawl_limits if isinstance(crawl_limits, dict) else {},
            },
        }

        feedback = {
            "status": status,
            "execution_summary": str(base.get("summary") or self._build_summary(
                capability.source_name,
                supported_filters,
                include_terms,
                exclude_terms,
                unsupported_constraints,
            )),
            "explanation": str(base.get("explanation") or "").strip() or None,
            "clarification_required": clarification_required,
            "unsupported_reason": str(base.get("unsupported_reason") or "").strip() or None,
        }

        if status == "needs_clarification" and not feedback["clarification_required"]:
            feedback["clarification_required"] = [
                "Clarify the exact subset, source section, or filter combination to apply."
            ]
        if status == "unsupported" and not feedback["unsupported_reason"]:
            feedback["unsupported_reason"] = "The current bot cannot honor all requested constraints."
        if status == "supported" and unsupported_constraints and not feedback["explanation"]:
            feedback["explanation"] = "The requested unsupported constraints were recorded but will not be applied."

        metadata = self._build_metadata(confidence=self._merge_confidence(base.get("confidence")))

        return {
            "planner_metadata": metadata,
            "feedback": feedback,
            "execution_plan": execution_plan,
        }

    def _merge_confidence(self, value: Any) -> float:
        try:
            conf = float(value)
            if conf > 1.0:
                conf = conf / 100.0
            return max(0.0, min(1.0, conf))
        except Exception:
            return 0.0

    def _string_list(self, value: Any) -> List[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            return [part.strip() for part in re.split(r"[,|/]", value) if part.strip()]
        return [str(value).strip()] if str(value).strip() else []

    def _canonicalize_supported_filters(self, source_key: str, supported_filters: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(supported_filters, dict):
            return {}
        normalized: Dict[str, Any] = {}
        for key, value in supported_filters.items():
            canonical_key = canonicalize_field(source_key, key)
            if not canonical_key:
                continue
            if isinstance(value, list):
                cleaned = [str(item).strip() for item in value if str(item).strip()]
                if cleaned:
                    normalized[canonical_key] = cleaned if len(cleaned) > 1 else cleaned[0]
            elif value not in (None, "", [], {}):
                normalized[canonical_key] = value
        return normalized


partial_scrape_planner_service = PartialScrapePlannerService()
