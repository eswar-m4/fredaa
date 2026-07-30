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
from app.services.scrapers.keysight_scraper import scrape_keysight_products
from app.services.scrapers.webmd_scraper import execute_webmd_partial_scrape

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


class KeysightPartialScrapeAdapter(PartialScrapeAdapter):
    source_key = "keysight"
    adapter_name = "keysight_partial_scrape_adapter"

    def execute(self, context: PartialScrapeExecutionContext) -> PartialScrapeRuntimeResult:
        plan = context.plan_result.execution_plan
        filters = dict(plan.supported_filters or {})
        if not filters:
            filters = dict((plan.adapter_payload or {}).get("filters") or {})

        records = scrape_keysight_products(filters)
        records = _apply_include_exclude_terms(records, plan.include_terms, plan.exclude_terms)
        total_matched = len(records)
        limit = _normalized_limit(context.max_results)
        returned_records = records[:limit]
        return PartialScrapeRuntimeResult(
            records=returned_records,
            execution_metadata=_build_execution_metadata(
                plan_result=context.plan_result,
                adapter_name=self.adapter_name,
                total_matched_records=total_matched,
                returned_records=len(returned_records),
                result_limit=limit,
                adapter_extra={
                    "adapter_kind": plan.adapter_kind,
                    "adapter_payload": plan.adapter_payload,
                    "filters": filters,
                },
            ),
        )


class WebMDPartialScrapeAdapter(PartialScrapeAdapter):
    source_key = "webmd"
    adapter_name = "webmd_partial_scrape_adapter"

    def execute(self, context: PartialScrapeExecutionContext) -> PartialScrapeRuntimeResult:
        plan = context.plan_result.execution_plan
        limit = _normalized_limit(context.max_results)
        outcome = execute_webmd_partial_scrape(
            plan.model_dump(mode="json") if hasattr(plan, "model_dump") else plan.dict(),
            limit=limit,
        )
        records = _apply_include_exclude_terms(outcome.records, plan.include_terms, plan.exclude_terms)
        total_matched = len(records)
        returned_records = records[:limit]
        metadata = _build_execution_metadata(
            plan_result=context.plan_result,
            adapter_name=self.adapter_name,
            total_matched_records=total_matched,
            returned_records=len(returned_records),
            result_limit=limit,
            adapter_extra={
                "adapter_kind": plan.adapter_kind,
                "adapter_payload": plan.adapter_payload,
                "discovery_urls": outcome.execution_metadata.get("discovery_urls", []),
                "candidate_profile_urls": outcome.execution_metadata.get("candidate_profile_urls", []),
                "profiles_scanned": outcome.execution_metadata.get("profiles_scanned", 0),
            },
        )
        return PartialScrapeRuntimeResult(records=returned_records, execution_metadata=metadata)


register_partial_scrape_adapter(KeysightPartialScrapeAdapter())
register_partial_scrape_adapter(WebMDPartialScrapeAdapter())


class InvestegatePartialScrapeAdapter(PartialScrapeAdapter):
    source_key = "investegate"
    adapter_name = "investegate_partial_scrape_adapter"

    def execute(self, context: PartialScrapeExecutionContext) -> PartialScrapeRuntimeResult:
        plan = context.plan_result.execution_plan
        import pandas as pd
        import os
        from app.api.demo_routes import filter_records, BASE_DIR
        
        # Check for URL hint
        live_url = None
        if plan.url_hints:
            live_url = plan.url_hints[0]
        elif plan.crawl_limits and isinstance(plan.crawl_limits, dict) and plan.crawl_limits.get("seed_urls"):
            live_url = plan.crawl_limits["seed_urls"][0]

        records = []
        parsed_live = False
        if live_url:
            import requests
            from bs4 import BeautifulSoup
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            try:
                response = requests.get(live_url, headers=headers, timeout=20)
                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, "html.parser")
                    table = soup.find("table", class_="table-investegate")
                    if table:
                        rows = table.find_all("tr")
                        for row in rows[1:]:
                            cols = row.find_all("td")
                            if len(cols) < 4:
                                continue
                            published_date = cols[0].text.strip()
                            source = cols[1].text.strip()
                            
                            company_col = cols[2]
                            company_name = company_col.text.strip()
                            company_link = ""
                            company_a = company_col.find("a", href=True)
                            if company_a:
                                company_link = company_a["href"]
                                if not company_link.startswith("http"):
                                    company_link = "https://www.investegate.co.uk" + company_link
                                    
                            article_col = cols[3]
                            article_subject = article_col.text.strip()
                            article_link = ""
                            article_a = article_col.find("a", href=True)
                            if article_a:
                                article_link = article_a["href"]
                                if not article_link.startswith("http"):
                                    article_link = "https://www.investegate.co.uk" + article_link
                                    
                            records.append({
                                "Company_Name": company_name,
                                "Company_Link": company_link,
                                "Article_Link": article_link,
                                "Article_Subject": article_subject,
                                "Published_Date": published_date,
                                "Source": source,
                                "RNS": source,
                                "Disposition": None,
                                "Comments": None,
                                "Disposition_Details": None,
                                "KeywordsMapped": None,
                                "Total_MatchKeyword": 0,
                                "Event_Name": None,
                            })
                        if records:
                            parsed_live = True
            except Exception as e:
                pass

        filters = plan.supported_filters or {}
        if not parsed_live:
            csv_path = os.path.join(BASE_DIR, "sample_investegate.csv")
            if os.path.exists(csv_path):
                df = pd.read_csv(csv_path)
                records = df.to_dict(orient="records")
                for r in records:
                    for k, v in r.items():
                        if pd.isna(v):
                            r[k] = None
            records = filter_records(records, filters)

        records = _apply_include_exclude_terms(records, plan.include_terms, plan.exclude_terms)

        total_matched = len(records)
        limit = _normalized_limit(context.max_results)
        returned_records = records[:limit]
        return PartialScrapeRuntimeResult(
            records=returned_records,
            execution_metadata=_build_execution_metadata(
                plan_result=context.plan_result,
                adapter_name=self.adapter_name,
                total_matched_records=total_matched,
                returned_records=len(returned_records),
                result_limit=limit,
                adapter_extra={
                    "adapter_kind": plan.adapter_kind,
                    "adapter_payload": plan.adapter_payload,
                    "filters": filters,
                    "live_url_used": live_url,
                    "parsed_live": parsed_live,
                },
            ),
        )


class TurkeyBrokersPartialScrapeAdapter(PartialScrapeAdapter):
    source_key = "turkeybrokers"
    adapter_name = "turkeybrokers_partial_scrape_adapter"

    def execute(self, context: PartialScrapeExecutionContext) -> PartialScrapeRuntimeResult:
        plan = context.plan_result.execution_plan
        import pandas as pd
        import os
        from app.api.demo_routes import filter_records, ensure_turkeybrokers_data, BASE_DIR
        
        ensure_turkeybrokers_data()
        csv_path = os.path.join(BASE_DIR, "sample_turkeybrokers.csv")
        records = []
        if os.path.exists(csv_path):
            df = pd.read_csv(csv_path)
            records = df.to_dict(orient="records")
            for r in records:
                for k, v in r.items():
                    if pd.isna(v):
                        r[k] = None

        filters = plan.supported_filters or {}
        records = filter_records(records, filters)
        records = _apply_include_exclude_terms(records, plan.include_terms, plan.exclude_terms)

        total_matched = len(records)
        limit = _normalized_limit(context.max_results)
        returned_records = records[:limit]
        return PartialScrapeRuntimeResult(
            records=returned_records,
            execution_metadata=_build_execution_metadata(
                plan_result=context.plan_result,
                adapter_name=self.adapter_name,
                total_matched_records=total_matched,
                returned_records=len(returned_records),
                result_limit=limit,
                adapter_extra={
                    "adapter_kind": plan.adapter_kind,
                    "adapter_payload": plan.adapter_payload,
                    "filters": filters,
                },
            ),
        )


register_partial_scrape_adapter(InvestegatePartialScrapeAdapter())
register_partial_scrape_adapter(TurkeyBrokersPartialScrapeAdapter())


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
