"""
Generic runtime adapter layer for AI-powered Partial Scrape.

The planner produces a structured execution plan. This module resolves that
plan to a source-specific adapter, executes the existing scraper, and returns
bounded live results plus execution metadata.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

from app.config import settings
from app.core.logger import setup_logger
from app.models.partial_scrape_schemas import PartialScrapePlanResult
from app.services.partial_scrape_capabilities import get_partial_scrape_capability, normalize_source_key

logger = setup_logger(__name__)


@dataclass(frozen=True)
class PartialScrapeExecutionContext:
    plan_result: PartialScrapePlanResult
    max_results: int


@dataclass(frozen=True)
class PartialScrapeRuntimeResult:
    records: List[Dict[str, Any]]
    execution_metadata: Dict[str, Any]


class PartialScrapeAdapter(ABC):
    source_key: str = ""
    adapter_name: str = ""

    @abstractmethod
    def execute(self, context: PartialScrapeExecutionContext) -> PartialScrapeRuntimeResult:
        raise NotImplementedError


class _AdapterRegistry:
    def __init__(self) -> None:
        self._adapters: Dict[str, PartialScrapeAdapter] = {}

    def register(self, adapter: PartialScrapeAdapter) -> None:
        key = normalize_source_key(adapter.source_key)
        self._adapters[key] = adapter

    def get(self, source_name: str) -> Optional[PartialScrapeAdapter]:
        key = normalize_source_key(source_name)
        return self._adapters.get(key)


_REGISTRY = _AdapterRegistry()


def register_partial_scrape_adapter(adapter: PartialScrapeAdapter) -> None:
    _REGISTRY.register(adapter)


def get_partial_scrape_adapter(source_name: str) -> Optional[PartialScrapeAdapter]:
    return _REGISTRY.get(source_name)


def _first_value(value: Any) -> Any:
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _flatten_record_text(record: Dict[str, Any]) -> str:
    parts: List[str] = []
    for value in record.values():
        if value in (None, ""):
            continue
        if isinstance(value, list):
            parts.extend(str(item) for item in value if item not in (None, ""))
        else:
            parts.append(str(value))
    return " ".join(parts).lower()


def _apply_include_exclude_terms(records: Iterable[Dict[str, Any]], include_terms: List[str], exclude_terms: List[str]) -> List[Dict[str, Any]]:
    include = [str(term).strip().lower() for term in include_terms if str(term).strip()]
    exclude = [str(term).strip().lower() for term in exclude_terms if str(term).strip()]
    if not include and not exclude:
        return list(records)

    filtered: List[Dict[str, Any]] = []
    for record in records:
        blob = _flatten_record_text(record)
        if include and not all(term in blob for term in include):
            continue
        if exclude and any(term in blob for term in exclude):
            continue
        filtered.append(record)
    return filtered


def _normalized_limit(max_results: Optional[int]) -> int:
    try:
        limit = int(max_results) if max_results is not None else int(settings.PARTIAL_SCRAPE_MAX_RESULTS)
    except Exception:
        limit = int(settings.PARTIAL_SCRAPE_MAX_RESULTS)
    return max(1, limit)


def _build_execution_metadata(
    *,
    plan_result: PartialScrapePlanResult,
    adapter_name: str,
    total_matched_records: int,
    returned_records: int,
    result_limit: int,
    adapter_extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    metadata = {
        "planner_version": plan_result.planner_metadata.planner_version,
        "planned_at": plan_result.planner_metadata.planned_at,
        "planner_confidence": plan_result.planner_metadata.confidence,
        "planner_model_name": plan_result.planner_metadata.model_name,
        "planner_provider_used": plan_result.planner_metadata.provider_used,
        "adapter_name": adapter_name,
        "source_key": plan_result.execution_plan.source_key,
        "source_name": plan_result.execution_plan.source_name,
        "execution_strategy": plan_result.execution_plan.execution_strategy,
        "total_matched_records": total_matched_records,
        "returned_records": returned_records,
        "result_limit": result_limit,
        "is_truncated": total_matched_records > returned_records,
    }
    if adapter_extra:
        metadata.update(adapter_extra)
    return metadata





def load_partial_scrape_plan(planner_json: str) -> PartialScrapePlanResult:
    payload = json.loads(planner_json)
    if hasattr(PartialScrapePlanResult, "model_validate"):
        return PartialScrapePlanResult.model_validate(payload)
    return PartialScrapePlanResult.parse_obj(payload)


def execute_partial_scrape(*, source_name: str, planner_json: str, max_results: Optional[int] = None) -> PartialScrapeRuntimeResult:
    plan_result = load_partial_scrape_plan(planner_json)
    capability = get_partial_scrape_capability(source_name)
    if capability is None:
        raise RuntimeError(f"No partial scrape capability registered for {source_name}")

    adapter = get_partial_scrape_adapter(capability.source_key)
    if adapter is None:
        raise RuntimeError(f"No partial scrape adapter registered for {source_name}")

    context = PartialScrapeExecutionContext(
        plan_result=plan_result,
        max_results=_normalized_limit(max_results),
    )
    return adapter.execute(context)
