"""
Temporary demo router for scraper integrations.
"""

import os
import json
import re
import random
import logging
from datetime import datetime
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.services.auth_service import auth_service
from app.services.partial_scrape_runtime import execute_partial_scrape
from app.services.partial_scrape_planner_service import partial_scrape_planner_service
from app.services.partial_scrape_capabilities import get_partial_scrape_capability

router = APIRouter()
logger = logging.getLogger(__name__)

# Resolve workspace root directory relative to this file
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

def _latest_run_number_for_job(job_id: str, refresh_count: Optional[int] = None) -> int:
    import glob
    dataset_dir = os.path.join(BASE_DIR, "datasets")
    pattern = os.path.join(dataset_dir, f"{job_id}_run_*.json")
    matching_files = glob.glob(pattern)
    max_run = 0
    for filepath in matching_files:
        basename = os.path.basename(filepath)
        match = re.search(r"_run_(\d+)\.json$", basename)
        if match:
            max_run = max(max_run, int(match.group(1)))
    if max_run > 0:
        return max_run
    if refresh_count is not None and refresh_count > 0:
        return refresh_count
    return 1


def _load_json_records(path: str) -> list[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            loaded = json.load(f)
        return loaded if isinstance(loaded, list) else []
    except Exception:
        return []


def _load_refresh_baseline_records(job_id: str, run_file_dir: str, current_run_num: int) -> tuple[list[Dict[str, Any]], str]:
    candidates = []
    final_path = os.path.join(run_file_dir, f"{job_id}_final.json")
    if os.path.exists(final_path):
        candidates.append(final_path)
    if current_run_num > 1:
        candidates.append(os.path.join(run_file_dir, f"{job_id}_run_{current_run_num - 1}.json"))
    input_path = os.path.join(run_file_dir, f"{job_id}_input.json")
    if os.path.exists(input_path):
        candidates.append(input_path)

    for candidate in candidates:
        records = _load_json_records(candidate)
        if records:
            return records, os.path.basename(candidate)

    return [], ""


def _build_refresh_comparison_log(
    source: str,
    baseline_records: list[Dict[str, Any]],
    records: list[Dict[str, Any]],
    *,
    baseline_file: str,
    current_file: str,
    execution_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    if not baseline_records:
        return {
            "baseline_file": baseline_file,
            "current_file": current_file,
            "records_compared": len(records),
            "added": len(records),
            "modified": 0,
            "deleted": 0,
            "verified": 0,
            "change_percentage": 100.0,
            "entrypoint_file": "run.py",
            "runtime_type": "python",
            "entrypoint_function": "run",
            "bot_execution": execution_metadata if isinstance(execution_metadata, dict) else {},
        }

    from app.services.wcm_comparison_service import compare_records

    flattened_rows, _ = compare_records(
        source,
        baseline_records,
        records,
        is_dataset=False,
    )
    record_groups: Dict[str, set[str]] = {}
    for row in flattened_rows:
        if not isinstance(row, dict):
            continue
        record_key = str(row.get("recordKey") or f"record_{row.get('recordIndex', 0)}")
        record_groups.setdefault(record_key, set()).add(str(row.get("changeType") or "V"))

    records_compared = len(record_groups) or len(records)
    added = sum(1 for types in record_groups.values() if "A" in types)
    modified = sum(1 for types in record_groups.values() if "M" in types)
    deleted = sum(1 for types in record_groups.values() if "D" in types)
    verified = sum(1 for types in record_groups.values() if types == {"V"})
    change_percentage = round(
        (
            sum(1 for types in record_groups.values() if any(flag in types for flag in ("A", "M", "D")))
            / records_compared
        )
        * 100,
        2,
    ) if records_compared else 0.0

    return {
        "baseline_file": baseline_file,
        "current_file": current_file,
        "records_compared": records_compared,
        "added": added,
        "modified": modified,
        "deleted": deleted,
        "verified": verified,
        "change_percentage": change_percentage,
        "entrypoint_file": "run.py",
        "runtime_type": "python",
        "entrypoint_function": "run",
        "bot_execution": execution_metadata if isinstance(execution_metadata, dict) else {},
    }

def _compute_next_refresh_at(frequency: Optional[str], now: Optional[datetime] = None) -> Optional[datetime]:
    if not frequency:
        return None
    freq = str(frequency).strip().lower()
    if freq in {"one-time", "one time", "once", "single", "single run"}:
        return None
    from datetime import datetime as dt, timedelta
    now = now or dt.utcnow()
    if freq in {"hourly", "every hour", "1 hour", "1 hr", "60 minutes"}:
        next_date = now + timedelta(hours=1)
    elif freq in {"2 minutes", "2 mins"}:
        next_date = now + timedelta(minutes=2)
    elif freq == "daily":
        next_date = now + timedelta(days=1)
    elif freq == "monthly":
        next_date = now + timedelta(days=30)
    elif freq == "quarterly":
        next_date = now + timedelta(days=90)
    else:
        next_date = now + timedelta(days=7)
    return next_date


def _calculate_next_refresh_str(frequency: Optional[str]) -> Optional[str]:
    next_refresh_at = _compute_next_refresh_at(frequency)
    if next_refresh_at is None:
        return None
    return next_refresh_at.isoformat() + "Z"

# --- Scraper Job Infrastructure ---

from typing import List, Dict, Any
from datetime import datetime
from fastapi import BackgroundTasks
from app.core.database import get_connection

class LaunchJobItem(BaseModel):
    id: str
    source: str
    scope: str
    filters: str
    custom_criteria: Optional[str] = None
    frequency: str
    delivery: str
    output_format: str
    isCustomSource: bool
    mode: str
    complexity: Optional[str] = None
    estimated_onboarding_time: Optional[str] = None
    planner_json: Optional[Dict[str, Any]] = None
    records: Optional[int] = None
    input_data: Optional[List[Dict[str, str]]] = None

class LaunchJobsRequest(BaseModel):
    jobs: List[LaunchJobItem]

class PendingJobItem(BaseModel):
    source_name: str
    website_url: str
    category: str
    complexity: str
    recommended_scraper_type: str
    estimated_development_effort: str
    status: str = "Analysis Complete"

def parse_criteria(criteria_str: str) -> dict:
    if not criteria_str or criteria_str in ("—", "- -", "All Products", "All Pages"):
        return {}
    criteria_str = criteria_str.strip()
    if criteria_str.startswith("{"):
        try:
            return json.loads(criteria_str)
        except Exception:
            pass
    
    filters = {}
    parts = criteria_str.split(",")
    for p in parts:
        if "=" in p:
            k, v = p.split("=", 1)
            k = k.strip().lower()
            v = v.strip()
            if "|" in v:
                filters[k] = [item.strip() for item in v.split("|")]
            else:
                filters[k] = v
    return filters

def filter_records(records: list, filters: dict) -> list:
    if not filters:
        return records
    filtered = []
    for r in records:
        match = True
        for fk, fv in filters.items():
            r_val = None
            for rk, rv in r.items():
                if rk.lower() == fk.lower() or rk.lower().replace("_", "") == fk.lower().replace("_", ""):
                    r_val = rv
                    break
            
            if r_val is None:
                match = False
                break
            
            if isinstance(fv, list):
                list_match = False
                for val in fv:
                    if str(val).lower() in str(r_val).lower():
                        list_match = True
                        break
                if not list_match:
                    match = False
                    break
            else:
                if str(fv).lower() not in str(r_val).lower():
                    match = False
                    break
        if match:
            filtered.append(r)
    return filtered


def _is_partial_scope(scope: Optional[str]) -> bool:
    normalized = str(scope or "").strip().lower()
    return normalized in {
        "partial scrape",
        "partial dump",
        "custom dump",
        "custom",
        "custom scrape",
    }


def _planner_payload_to_json(plan_result: Any) -> str:
    if plan_result is None:
        return ""
    if hasattr(plan_result, "model_dump"):
        payload = plan_result.model_dump(mode="json")
    elif hasattr(plan_result, "dict"):
        payload = plan_result.dict()
    elif isinstance(plan_result, dict):
        payload = plan_result
    else:
        payload = {"value": plan_result}
    return json.dumps(payload, ensure_ascii=False, default=str)


def _extract_partial_scrape_filters(planner_json: Optional[str], legacy_filters: str) -> dict:
    if planner_json:
        try:
            payload = json.loads(planner_json)
            execution_plan = payload.get("execution_plan") if isinstance(payload, dict) else {}
            if isinstance(execution_plan, dict):
                filters = execution_plan.get("supported_filters") or {}
                if isinstance(filters, dict):
                    return filters
                adapter_payload = execution_plan.get("adapter_payload") or {}
                if isinstance(adapter_payload, dict):
                    nested = adapter_payload.get("filters")
                    if isinstance(nested, dict):
                        return nested
        except Exception:
            pass
    return parse_criteria(legacy_filters)

import asyncio

def get_record_key(source: str, r: dict) -> str:
    src = source.lower()
    if "cars.com" in src or "cars" in src:
        return str(r.get("vin") or r.get("VIN") or r.get("listing_url") or r.get("Listing_Url") or "")
    if "amazon" in src:
        return str(r.get("asin") or r.get("ASIN") or r.get("sku") or r.get("SKU") or "")
    if "mca" in src:
        return str(r.get("registry_number") or r.get("cin") or r.get("CIN") or "")
    if "companies house" in src or "companieshouse" in src:
        return str(r.get("registry_number") or r.get("company_number") or "")
    if "crunchbase" in src:
        return str(r.get("company_domain") or r.get("domain") or r.get("source_url") or "")
    return str(r.get("url") or r.get("id") or "")

def simulate_demo_mutations(source: str, records: list) -> list:
    if not records:
        return records
    import copy
    mutated = copy.deepcopy(records)
    return mutated


def _is_gasunie_demand_prod_source(source: str) -> bool:
    source_lower = str(source or "").strip().lower()
    return (
        "gasunie deutschland tso demand prod" in source_lower
        or "tron-gud.publication.virtimo.cloud" in source_lower
    )


async def _run_gasunie_demand_prod_job(job_id: str, source: str, frequency: Optional[str]) -> None:
    import importlib.util
    from pathlib import Path

    gasunie_root = Path(BASE_DIR) / "data" / "bot_packages" / "gasunie_deutschland_tso_demand_prod" / "ICIS_TSO13_GasunieDeutschland_TSO_Demand_Prod"
    run_py = gasunie_root / "run.py"
    if not run_py.exists():
        raise FileNotFoundError(f"Gasunie runner not found at {run_py}")

    spec = importlib.util.spec_from_file_location("gasunie_demand_prod_runner", run_py)
    if spec is None or spec.loader is None:
        raise ValueError("Failed to load Gasunie runner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]

    execution = module.run(
        {
            "job_id": job_id,
            "source": source,
            "frequency": frequency or "One-time",
            "timeout_sec": 5400,
            "outputs_dir": os.path.join(BASE_DIR, "datasets"),
            "artifacts_dir": os.path.join(BASE_DIR, "datasets"),
        }
    )

    records = execution.get("records") if isinstance(execution, dict) else []
    execution_metadata = execution.get("execution_metadata") if isinstance(execution, dict) else {}
    if not isinstance(records, list) or not records:
        raise ValueError("Gasunie runner did not return any records")

    run_file_dir = os.path.join(BASE_DIR, "datasets")
    os.makedirs(run_file_dir, exist_ok=True)
    with get_connection() as conn:
        row = conn.execute("SELECT refresh_count FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
    current_run_num = _latest_run_number_for_job(job_id, int(row[0]) if row and row[0] is not None else None)
    next_run_num = max(1, current_run_num + 1)
    run_file_path = os.path.join(run_file_dir, f"{job_id}_run_{next_run_num}.json")
    with open(run_file_path, "w", encoding="utf-8") as f_run:
        json.dump(records, f_run, ensure_ascii=False, indent=2)

    now_str = datetime.utcnow().isoformat() + "Z"
    next_refresh_str = _calculate_next_refresh_str(frequency)
    baseline_records, baseline_file = _load_refresh_baseline_records(job_id, run_file_dir, next_run_num)
    comparison_log = _build_refresh_comparison_log(
        source,
        baseline_records,
        records,
        baseline_file=baseline_file,
        current_file=f"{job_id}_run_{next_run_num}.json",
        execution_metadata=execution_metadata,
    )
    with open(os.path.join(run_file_dir, f"{job_id}_comparison.json"), "w", encoding="utf-8") as f_comp:
        json.dump(comparison_log, f_comp, ensure_ascii=False, indent=2)

    with get_connection() as conn:
        existing_history_json = conn.execute(
            "SELECT refresh_history_json FROM scraper_jobs WHERE id = ?",
            (job_id,)
        ).fetchone()[0]

    history = json.loads(existing_history_json or "[]")
    history.append(
        {
            "timestamp": now_str,
            "records_scraped": len(records),
            "accuracy_rate": 100,
            "status": "Success",
            "execution_time_seconds": 0,
        }
    )

    with get_connection() as conn:
        conn.execute(
            """UPDATE scraper_jobs
               SET status = 'Review Pending',
                   records = ?,
                   fresh = 100,
                   last_refresh = ?,
                   next_refresh = ?,
                   refresh_count = ?,
                   refresh_history_json = ?,
                   changes_detected = ?
               WHERE id = ?""",
            (len(records), now_str, next_refresh_str, next_run_num, json.dumps(history), len(records), job_id)
        )
        conn.commit()

    from app.services.workflow_service import workflow_service

    workflow_service.runs[job_id] = {
        "run_id": job_id,
        "dataset_id": job_id,
        "dataset_name": source,
        "processed_dataset": records,
        "comparison_log": comparison_log,
        "bot_execution": execution_metadata if isinstance(execution_metadata, dict) else {},
    }
    try:
        from app.services.wcm_comparison_service import warm_review_cache
        asyncio.create_task(warm_review_cache(job_id, 2.0))
    except Exception:
        pass


def _is_nationalgrid_tso29_source(source: str) -> bool:
    source_lower = str(source or "").strip().lower()
    return (
        "nationalgrid tso29 gasflow sso nomrenom prod dem" in source_lower
        or "national grid" in source_lower
        or "national gas" in source_lower
        or "data.nationalgas.com" in source_lower
    )


def _is_bse_stock_exchange_source(source: str) -> bool:
    source_lower = str(source or "").strip().lower()
    return (
        "bombay stock exchange" in source_lower
        or "bseindia.com/corporates/historicalannualreport.aspx" in source_lower
        or "bseindia.com" in source_lower
    )


async def _run_bse_stock_exchange_job(job_id: str, source: str, frequency: Optional[str]) -> None:
    import importlib.util
    from pathlib import Path

    bse_root = Path(BASE_DIR) / "data" / "bot_packages" / "bse_stock_exchange" / "Bombay_Stock_Exchange"
    run_py = bse_root / "run.py"
    if not run_py.exists():
        raise FileNotFoundError(f"BSE runner not found at {run_py}")

    spec = importlib.util.spec_from_file_location("bse_stock_exchange_runner", run_py)
    if spec is None or spec.loader is None:
        raise ValueError("Failed to load BSE runner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]

    execution = module.run(
        {
            "job_id": job_id,
            "source": source,
            "frequency": frequency or "Weekly",
            "timeout_sec": 1800,
            "outputs_dir": os.path.join(BASE_DIR, "datasets"),
            "artifacts_dir": os.path.join(BASE_DIR, "datasets"),
        }
    )

    records = execution.get("records") if isinstance(execution, dict) else []
    execution_metadata = execution.get("execution_metadata") if isinstance(execution, dict) else {}
    if not isinstance(records, list) or not records:
        raise ValueError("BSE runner did not return any records")

    run_file_dir = os.path.join(BASE_DIR, "datasets")
    os.makedirs(run_file_dir, exist_ok=True)
    with get_connection() as conn:
        row = conn.execute("SELECT refresh_count FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
    current_run_num = _latest_run_number_for_job(job_id, int(row[0]) if row and row[0] is not None else None)
    next_run_num = max(1, current_run_num + 1)
    run_file_path = os.path.join(run_file_dir, f"{job_id}_run_{next_run_num}.json")
    with open(run_file_path, "w", encoding="utf-8") as f_run:
        json.dump(records, f_run, ensure_ascii=False, indent=2)

    now_str = datetime.utcnow().isoformat() + "Z"
    next_refresh_str = _calculate_next_refresh_str(frequency)
    baseline_records, baseline_file = _load_refresh_baseline_records(job_id, run_file_dir, next_run_num)
    comparison_log = _build_refresh_comparison_log(
        source,
        baseline_records,
        records,
        baseline_file=baseline_file,
        current_file=f"{job_id}_run_{next_run_num}.json",
        execution_metadata=execution_metadata,
    )
    with open(os.path.join(run_file_dir, f"{job_id}_comparison.json"), "w", encoding="utf-8") as f_comp:
        json.dump(comparison_log, f_comp, ensure_ascii=False, indent=2)

    with get_connection() as conn:
        existing_history_json = conn.execute(
            "SELECT refresh_history_json FROM scraper_jobs WHERE id = ?",
            (job_id,)
        ).fetchone()[0]

    history = json.loads(existing_history_json or "[]")
    history.append(
        {
            "timestamp": now_str,
            "records_scraped": len(records),
            "accuracy_rate": 100,
            "status": "Success",
            "execution_time_seconds": 0,
        }
    )

    with get_connection() as conn:
        conn.execute(
            """UPDATE scraper_jobs
               SET status = 'Review Pending',
                   records = ?,
                   fresh = 100,
                   last_refresh = ?,
                   next_refresh = ?,
                   refresh_count = ?,
                   refresh_history_json = ?,
                   changes_detected = ?
               WHERE id = ?""",
            (len(records), now_str, next_refresh_str, next_run_num, json.dumps(history), len(records), job_id)
        )
        conn.commit()

    from app.services.workflow_service import workflow_service

    workflow_service.runs[job_id] = {
        "run_id": job_id,
        "dataset_id": job_id,
        "dataset_name": source,
        "processed_dataset": records,
        "comparison_log": comparison_log,
        "bot_execution": execution_metadata if isinstance(execution_metadata, dict) else {},
    }
    try:
        from app.services.wcm_comparison_service import warm_review_cache
        asyncio.create_task(warm_review_cache(job_id, 2.0))
    except Exception:
        pass


async def _run_nationalgrid_tso29_job(job_id: str, source: str, frequency: Optional[str]) -> None:
    import importlib.util
    from pathlib import Path

    nationalgrid_root = Path(BASE_DIR) / "data" / "bot_packages" / "nationalgrid_tso29_gasflow_sso_nomrenom_prod_dem" / "ICIS_TSO_TSO29_NationalGrid_Gasflow_SSO_Nomrenom_Prod_Dem"
    run_py = nationalgrid_root / "run.py"
    if not run_py.exists():
        raise FileNotFoundError(f"NationalGrid runner not found at {run_py}")

    spec = importlib.util.spec_from_file_location("nationalgrid_tso29_runner", run_py)
    if spec is None or spec.loader is None:
        raise ValueError("Failed to load NationalGrid runner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]

    execution = module.run(
        {
            "job_id": job_id,
            "source": source,
            "frequency": frequency or "One-time",
            "timeout_sec": 1800,
            "outputs_dir": os.path.join(BASE_DIR, "datasets"),
            "artifacts_dir": os.path.join(BASE_DIR, "datasets"),
        }
    )

    records = execution.get("records") if isinstance(execution, dict) else []
    execution_metadata = execution.get("execution_metadata") if isinstance(execution, dict) else {}
    if not isinstance(records, list) or not records:
        raise ValueError("NationalGrid runner did not return any records")

    run_file_dir = os.path.join(BASE_DIR, "datasets")
    os.makedirs(run_file_dir, exist_ok=True)
    with get_connection() as conn:
        row = conn.execute("SELECT refresh_count FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
    current_run_num = _latest_run_number_for_job(job_id, int(row[0]) if row and row[0] is not None else None)
    next_run_num = max(1, current_run_num + 1)
    run_file_path = os.path.join(run_file_dir, f"{job_id}_run_{next_run_num}.json")
    with open(run_file_path, "w", encoding="utf-8") as f_run:
        json.dump(records, f_run, ensure_ascii=False, indent=2)

    now_str = datetime.utcnow().isoformat() + "Z"
    next_refresh_str = _calculate_next_refresh_str(frequency)
    baseline_records, baseline_file = _load_refresh_baseline_records(job_id, run_file_dir, next_run_num)
    comparison_log = _build_refresh_comparison_log(
        source,
        baseline_records,
        records,
        baseline_file=baseline_file,
        current_file=f"{job_id}_run_{next_run_num}.json",
        execution_metadata=execution_metadata,
    )
    with open(os.path.join(run_file_dir, f"{job_id}_comparison.json"), "w", encoding="utf-8") as f_comp:
        json.dump(comparison_log, f_comp, ensure_ascii=False, indent=2)

    with get_connection() as conn:
        existing_history_json = conn.execute(
            "SELECT refresh_history_json FROM scraper_jobs WHERE id = ?",
            (job_id,)
        ).fetchone()[0]

    history = json.loads(existing_history_json or "[]")
    history.append(
        {
            "timestamp": now_str,
            "records_scraped": len(records),
            "accuracy_rate": 100,
            "status": "Success",
            "execution_time_seconds": 0,
        }
    )

    with get_connection() as conn:
        conn.execute(
            """UPDATE scraper_jobs
               SET status = 'Review Pending',
                   records = ?,
                   fresh = 100,
                   last_refresh = ?,
                   next_refresh = ?,
                   refresh_count = ?,
                   refresh_history_json = ?,
                   changes_detected = ?
               WHERE id = ?""",
            (len(records), now_str, next_refresh_str, next_run_num, json.dumps(history), len(records), job_id)
        )
        conn.commit()

    from app.services.workflow_service import workflow_service

    workflow_service.runs[job_id] = {
        "run_id": job_id,
        "dataset_id": job_id,
        "dataset_name": source,
        "processed_dataset": records,
        "comparison_log": comparison_log,
        "bot_execution": execution_metadata if isinstance(execution_metadata, dict) else {},
    }
    try:
        from app.services.wcm_comparison_service import warm_review_cache
        asyncio.create_task(warm_review_cache(job_id, 2.0))
    except Exception:
        pass

async def run_scraper_background(job_id: str):
    # 1. Fetch info from DB first to check if custom source onboarding and avoid multiple database queries
    with get_connection() as conn:
        job_info_db = conn.execute(
            """SELECT refresh_count, frequency, mode, is_custom_source, complexity, estimated_onboarding_time,
                      source, scope, filters, custom_criteria, planner_json, records, status
               FROM scraper_jobs WHERE id = ?""",
            (job_id,)
        ).fetchone()
        
    if not job_info_db:
        return
        
    refresh_count_curr = job_info_db[0]
    frequency = job_info_db[1]
    job_mode = job_info_db[2]
    is_custom = job_info_db[3]
    complexity = job_info_db[4]
    estimated_onboarding_time = job_info_db[5]
    source = job_info_db[6]
    scope = job_info_db[7]
    filters_str = job_info_db[8]
    custom_criteria = job_info_db[9]
    planner_json = job_info_db[10]
    uploaded_records = job_info_db[11]
    current_status = job_info_db[12]

    # Keep any onboarding-bound jobs pending until a dedicated onboarding flow updates them.
    if str(current_status) == "Pending Onboarding":
        return
    
    # Update status to 'Running'
    with get_connection() as conn:
        conn.execute(
            "UPDATE scraper_jobs SET status = 'Running' WHERE id = ?",
            (job_id,)
        )
        conn.commit()

    # Simulate scraper run time (onboarding duration for first run of custom source, or 5s standard)
    if bool(is_custom) and refresh_count_curr == 0:
        duration = 30
        if estimated_onboarding_time:
            effort = str(estimated_onboarding_time).lower()
            if "1-2 days" in effort:
                duration = 30
            elif "3-5 days" in effort:
                duration = 60
            elif "1-2 weeks" in effort:
                duration = 120
            elif "2+ weeks" in effort:
                duration = 180
        elif complexity:
            comp = str(complexity).lower()
            if "easy" in comp or "simple" in comp:
                duration = 30
            elif "medium" in comp:
                duration = 60
            elif "hard" in comp:
                duration = 120
            elif "very hard" in comp:
                duration = 180
        await asyncio.sleep(duration)
    else:
        await asyncio.sleep(5)

    # Reload job state to get updated filters_str if modified above
    with get_connection() as conn:
        row = conn.execute("SELECT filters, planner_json FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
        if row:
            filters_str = row[0]
            planner_json = row[1]

    records = []
    source_lower = source.lower()
    resolved_filters = _extract_partial_scrape_filters(planner_json, filters_str)
    partial_scrape_metadata: Dict[str, Any] = {}
    
    try:
        if job_mode in ("By Dataset", "Any-Site"):
            # 1. Parse filters configuration
            config_data = {}
            if filters_str:
                try:
                    config_data = json.loads(filters_str)
                except Exception:
                    pass
            selected_outputs = config_data.get("selectedOutputs") or []
            mapping = config_data.get("mapping") or {}
            picked_sources = config_data.get("pickedSources") or []

            # 2. Load input rows
            input_file_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_input.json")
            input_rows = []
            if os.path.exists(input_file_path):
                try:
                    with open(input_file_path, "r", encoding="utf-8") as f_in:
                        input_rows = json.load(f_in)
                except Exception:
                    pass

            if not input_rows:
                # Default mock input records if none uploaded
                input_rows = [
                    {"company_name": "Acme Corp", "corp_site": "https://acme.com", "phone": "+1 555-0199", "email": "info@acme.com", "linkedin": "https://www.linkedin.com/company/acme"},
                    {"company_name": "Bolt.new", "corp_site": "https://bolt.new", "phone": "+1 555-0200", "email": "contact@bolt.new", "linkedin": "https://www.linkedin.com/company/boltdotnew"},
                    {"company_name": "Vercel", "corp_site": "https://vercel.com", "phone": "+1 555-0201", "email": "support@vercel.com", "linkedin": "https://www.linkedin.com/company/vercel"},
                    {"company_name": "Supabase", "corp_site": "https://supabase.com", "phone": "+1 555-0202", "email": "sales@supabase.io", "linkedin": "https://www.linkedin.com/company/supabase"},
                    {"company_name": "OpenAI", "corp_site": "https://openai.com", "phone": "+1 555-0203", "email": "press@openai.com", "linkedin": "https://www.linkedin.com/company/openai"}
                ]
                if not mapping:
                    mapping = {
                        "legal_name": "company_name",
                        "website": "corp_site",
                        "phone": "phone",
                        "email": "email",
                        "linkedin_url": "linkedin"
                    }

            # 3. Execute enrichment
            from app.services.company_verification_service import company_verification_service
            from app.services.registry_scrapers.sec_scraper import sec_scraper
            from app.services.registry_scrapers.mca_scraper import mca_scraper
            from app.services.enrichment_service import enrichment_service
            from app.services.workflow_service import workflow_service, parse_employee_count, parse_headquarters
            
            run_website = any("website" in str(s).lower() and "linkedin" not in str(s).lower() for s in picked_sources)
            run_sec = any("sec" in str(s).lower() or "edgar" in str(s).lower() for s in picked_sources)
            run_linkedin = any("linkedin" in str(s).lower() for s in picked_sources)
            run_mca = any("mca" in str(s).lower() for s in picked_sources)
            run_crunchbase = any("crunchbase" in str(s).lower() for s in picked_sources)
            run_builtwith = any("builtwith" in str(s).lower() for s in picked_sources)

            # By Dataset should always run the core enrichment sources.
            run_website = True
            run_sec = True
            run_mca = True
            if not picked_sources:
                run_builtwith = True

            def _is_present(value: Any) -> bool:
                if value is None:
                    return False
                if isinstance(value, str):
                    return bool(value.strip()) and value.strip().lower() not in ("n/a", "na", "none", "null", "-", "â€”")
                if isinstance(value, (list, tuple, set, dict)):
                    return bool(value)
                return True

            def _first_present(*values: Any) -> Any:
                for value in values:
                    if _is_present(value):
                        return value
                return None

            def _strip_internal_keys(row: Dict[str, Any]) -> Dict[str, Any]:
                return {k: v for k, v in (row or {}).items() if not str(k).startswith("_")}

            def _extract_public_context(row: Dict[str, Any], **context_parts: Dict[str, Any]) -> Dict[str, Any]:
                context: Dict[str, Any] = {}
                for ctx_name, ctx_value in context_parts.items():
                    if isinstance(ctx_value, dict) and ctx_value:
                        context[ctx_name] = _strip_internal_keys(ctx_value)
                    elif _is_present(ctx_value):
                        context[ctx_name] = ctx_value
                return context

            # Concurrency limit and task definition
            sem = asyncio.Semaphore(5)

            def _normalize_uploaded_key(value: Any) -> str:
                return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())

            def _normalize_http_url(value: Any) -> str:
                text = str(value or "").strip()
                if not text:
                    return ""
                if "://" not in text:
                    return f"https://{text}"
                return text

            def _resolve_uploaded_value(record: Dict[str, Any], *field_names: str) -> Any:
                if not isinstance(record, dict):
                    return None

                normalized_record = {
                    _normalize_uploaded_key(key): value
                    for key, value in record.items()
                }

                for field_name in field_names:
                    if not field_name:
                        continue
                    mapped_header = mapping.get(field_name)
                    candidates = [mapped_header, field_name]
                    for candidate in candidates:
                        if not candidate:
                            continue
                        value = normalized_record.get(_normalize_uploaded_key(candidate))
                        if value not in (None, "", [], {}):
                            return value
                return None

            async def process_record_safe(idx, record):
                async with sem:
                    record = dict(record or {})
                    company_val = _resolve_uploaded_value(record, "legal_name", "company_name")
                    if not company_val:
                        return {key: None for key in selected_outputs}

                    website_val = _resolve_uploaded_value(record, "website")
                    normalized_website_val = _normalize_http_url(website_val)
                    email_val = _resolve_uploaded_value(record, "email")
                    phone_val = _resolve_uploaded_value(record, "phone")
                    linkedin_val = _resolve_uploaded_value(record, "linkedin_url")
                    registry_val = _resolve_uploaded_value(record, "registry_number")
                    ticker_val = _resolve_uploaded_value(record, "ticker")
                    
                    scraped_metadata = {}
                    website_resolved = None
                    website_enrichment = {}
                    sec_fields = {}
                    mca_fields = {}
                    linkedin_metadata = {}
                    
                    # Run the real enrichment stack for every record in the uploaded dataset.
                    should_scrape = True

                    if should_scrape and (run_website or run_builtwith):
                        scrape_url = normalized_website_val or website_val or ""
                        if scrape_url:
                            try:
                                from app.services.scrapers.website_scraper import fetch_website_metadata
                                raw_meta = await asyncio.wait_for(
                                    fetch_website_metadata(scrape_url),
                                    timeout=60.0,
                                )
                                if raw_meta and not raw_meta.get("_blocked"):
                                    scraped_metadata = raw_meta
                                    website_resolved = raw_meta.get("url") or scrape_url
                                    # Merge any enrichment_service overlay on top
                                    try:
                                        website_enrichment = await asyncio.wait_for(
                                            asyncio.to_thread(
                                                enrichment_service.enrich,
                                                [{"url": scrape_url}],
                                                [{"result": record}],
                                            ),
                                            timeout=15.0,
                                        )
                                        if isinstance(website_enrichment, dict) and website_enrichment:
                                            scraped_metadata = {
                                                **scraped_metadata,
                                                **{
                                                    k: v
                                                    for k, v in website_enrichment.items()
                                                    if v not in (None, "", [], {})
                                                },
                                            }
                                    except Exception as e:
                                        logger.warning("[By Dataset] Enrichment overlay failed for %s: %s", company_val, e)
                            except Exception as e:
                                logger.warning("[By Dataset] Website scrape failed for %s: %s", company_val, e)

                    if should_scrape and run_sec:
                        try:
                            res_sec = await asyncio.wait_for(
                                sec_scraper.lookup_company(
                                    company_val,
                                    cik=registry_val,
                                    ticker=ticker_val
                                ),
                                timeout=15.0
                            )
                            if res_sec.get("raw_metadata", {}).get("status") == "success":
                                sec_fields = res_sec.get("extracted_fields") or {}
                        except Exception as e:
                            logger.warning("[By Dataset] SEC EDGAR lookup failed/timed out for %s: %s", company_val, e)

                    if should_scrape and run_mca:
                        try:
                            res_mca = await asyncio.wait_for(
                                mca_scraper.lookup_company(company_val),
                                timeout=10.0
                            )
                            if res_mca.get("raw_metadata", {}).get("status") == "success":
                                mca_fields = res_mca.get("extracted_fields") or {}
                        except Exception as e:
                            logger.warning("[By Dataset] MCA lookup failed/timed out for %s: %s", company_val, e)

                    if should_scrape and run_linkedin:
                        try:
                            discovery = await asyncio.wait_for(
                                asyncio.to_thread(
                                    workflow_service._discover_linkedin_search_evidence,
                                    company_val
                                ),
                                timeout=10.0
                            )
                            if discovery and "metadata" in discovery:
                                linkedin_metadata = discovery.get("metadata") or {}
                                if "linkedin_url" in discovery:
                                    linkedin_metadata["linkedin_url"] = discovery["linkedin_url"]
                        except Exception as e:
                            logger.warning("[By Dataset] LinkedIn lookup failed/timed out for %s: %s", company_val, e)

                    cb_fields = {}
                    if should_scrape and run_crunchbase:
                        try:
                            # Crunchbase real service integration point:
                            # from app.services.crunchbase_service import crunchbase_service
                            # cb_fields = await crunchbase_service.lookup_company(company_val)
                            pass
                        except Exception as e:
                            logger.warning("[By Dataset] Crunchbase lookup failed for %s: %s", company_val, e)

                    enriched_row = {}
                    
                    sec_addr = sec_fields.get("profile", {}).get("business_address") or {}
                    sec_street = " ".join(p for p in [sec_addr.get("street1"), sec_addr.get("street2")] if p) or None
                    sec_city = sec_addr.get("city") or None
                    sec_state = sec_addr.get("stateOrCountry") or None
                    sec_country = sec_addr.get("country") or ("USA" if sec_state else None)

                    mca_addr_str = mca_fields.get("registered_office_address") or ""
                    mca_hq = parse_headquarters(mca_addr_str) if mca_addr_str else {"city": None, "state": None, "country": None}

                    li_hq_str = linkedin_metadata.get("headquarters") or linkedin_metadata.get("linkedin_headquarters") or ""
                    li_hq = parse_headquarters(li_hq_str) if li_hq_str else {"city": None, "state": None, "country": None}
                    
                    for key in selected_outputs:
                        if key in ("company_name", "legal_name"):
                            val = sec_fields.get("entity_name") or mca_fields.get("company_name") or linkedin_metadata.get("company_name") or linkedin_metadata.get("linkedin_company_name") or scraped_metadata.get("detected_company_name") or company_val
                            enriched_row[key] = val if val else None
                        elif key == "website":
                            val = sec_fields.get("website") or linkedin_metadata.get("website") or linkedin_metadata.get("linkedin_website") or scraped_metadata.get("url") or website_resolved or normalized_website_val or website_val
                            enriched_row[key] = val if val else None
                        elif key == "description":
                            val = (
                                linkedin_metadata.get("description")
                                or linkedin_metadata.get("linkedin_description")
                                or website_enrichment.get("description")
                                or scraped_metadata.get("description")
                                or scraped_metadata.get("meta_description")
                                or sec_fields.get("sic_description")
                            )
                            enriched_row[key] = val if val else None
                        elif key in ("founded_year", "year_founded"):
                            val = (
                                sec_fields.get("year_founded")
                                or mca_fields.get("year_founded")
                                or linkedin_metadata.get("year_founded")
                                or scraped_metadata.get("year_founded")
                                or scraped_metadata.get("founding_year")
                            )
                            enriched_row[key] = val if val else None
                        elif key in ("phone", "contact_phone"):
                            phones = scraped_metadata.get("phone_numbers") or []
                            val = (
                                sec_fields.get("profile", {}).get("phone")
                                or website_enrichment.get("possible_phone")
                                or scraped_metadata.get("possible_phone")
                                or (phones[0] if phones else None)
                                or phone_val
                            )
                            enriched_row[key] = val if val else None
                        elif key in ("email", "contact_email"):
                            emails = scraped_metadata.get("emails") or []
                            val = (
                                website_enrichment.get("possible_email")
                                or scraped_metadata.get("possible_email")
                                or (emails[0] if emails else None)
                                or email_val
                            )
                            enriched_row[key] = val if val else None
                        elif key in ("linkedin_url", "contact_linkedin"):
                            val = linkedin_metadata.get("linkedin_url") or linkedin_val
                            if not val:
                                links = [l for l in scraped_metadata.get("social_links", []) if "linkedin.com" in l]
                                val = links[0] if links else None
                            enriched_row[key] = val if val else None
                        elif key in ("twitter_handle", "twitter_url"):
                            links = [l for l in scraped_metadata.get("social_links", []) if "twitter.com" in l or "x.com" in l]
                            enriched_row[key] = links[0] if links else None
                        elif key == "facebook_url":
                            links = [l for l in scraped_metadata.get("social_links", []) if "facebook.com" in l]
                            enriched_row["facebook_url"] = links[0] if links else None
                        elif key == "hq_address":
                            val = (
                                sec_street
                                or mca_fields.get("registered_office_address")
                                or li_hq_str
                                or scraped_metadata.get("hq_address")
                                or website_enrichment.get("address")
                                or scraped_metadata.get("address")
                            )
                            enriched_row[key] = val if val else None
                        elif key == "hq_city":
                            val = sec_city or mca_hq.get("city") or li_hq.get("city") or scraped_metadata.get("hq_city") or scraped_metadata.get("city")
                            enriched_row[key] = val if val else None
                        elif key == "hq_state":
                            val = sec_state or mca_hq.get("state") or li_hq.get("state") or scraped_metadata.get("hq_state") or scraped_metadata.get("state")
                            enriched_row[key] = val if val else None
                        elif key == "hq_country":
                            val = sec_country or ("India" if mca_fields.get("registered_office_address") else None) or li_hq.get("country") or scraped_metadata.get("hq_country") or scraped_metadata.get("country")
                            enriched_row[key] = val if val else None
                        elif key == "country":
                            val = sec_country or ("India" if mca_fields.get("registered_office_address") else None) or li_hq.get("country") or scraped_metadata.get("hq_country") or scraped_metadata.get("country")
                            enriched_row[key] = val if val else None
                        elif key == "registry_number":
                            val = sec_fields.get("cik") or mca_fields.get("cin") or registry_val
                            enriched_row[key] = val if val else None
                        elif key == "ticker":
                            enriched_row["ticker"] = sec_fields.get("ticker") or None
                        elif key == "sic_code":
                            enriched_row["sic_code"] = sec_fields.get("sic") or None
                        elif key == "incorporation_state":
                            enriched_row["incorporation_state"] = sec_fields.get("state_of_incorporation") or None
                        elif key == "fiscal_year":
                            enriched_row["fiscal_year"] = sec_fields.get("fiscal_year_end") or None
                        elif key == "industry":
                            val = sec_fields.get("sic_description") or linkedin_metadata.get("industry") or linkedin_metadata.get("linkedin_industry") or scraped_metadata.get("detected_industry") or scraped_metadata.get("industry")
                            enriched_row[key] = val if val else None
                        elif key == "sub_industry":
                            val = sec_fields.get("sic_description") or linkedin_metadata.get("industry") or linkedin_metadata.get("linkedin_industry") or scraped_metadata.get("detected_industry") or scraped_metadata.get("industry")
                            enriched_row[key] = val if val else None
                        elif key in ("employees", "employee_count"):
                            li_emp = parse_employee_count(linkedin_metadata.get("company_size") or linkedin_metadata.get("linkedin_company_size"))
                            enriched_row[key] = li_emp if li_emp else cb_fields.get("employee_count") or cb_fields.get("employee_range") or None
                        elif key == "employee_range":
                            val = linkedin_metadata.get("linkedin_employee_range") or linkedin_metadata.get("company_size") or cb_fields.get("employee_range")
                            enriched_row[key] = val if val else None
                        elif key in ("annual_revenue", "revenue", "revenue_range", "net_income", "assets", "liabilities"):
                            val = (
                                cb_fields.get(key)
                                or cb_fields.get("annual_revenue")
                                or scraped_metadata.get(key)
                                or website_enrichment.get(key)
                            )
                            enriched_row[key] = val if val else None
                        elif key in ("funding_total", "latest_round", "latest_round_amount", "valuation", "investors", "last_round", "amount_raised"):
                            val = (
                                cb_fields.get(key)
                                or cb_fields.get("funding_total")
                                or cb_fields.get("latest_round")
                                or cb_fields.get("latest_round_amount")
                                or scraped_metadata.get(key)
                                or website_enrichment.get(key)
                            )
                            enriched_row[key] = val if val else None
                        elif key in ("company_type", "ownership"):
                            val = sec_fields.get(key) or mca_fields.get(key) or linkedin_metadata.get(key) or scraped_metadata.get(key) or website_enrichment.get(key)
                            enriched_row[key] = val if val else None
                        elif key in ("cms", "analytics", "frameworks", "hosting", "tech_stack"):
                            val = (
                                website_enrichment.get(key)
                                or scraped_metadata.get(key)
                                or sec_fields.get(key)
                                or mca_fields.get(key)
                                or linkedin_metadata.get(key)
                            )
                            enriched_row[key] = val if val else None
                        else:
                            matched_val = record.get(mapping.get(key) or key)
                            enriched_row[key] = matched_val if matched_val is not None else None
                    enriched_row["_source_context"] = _extract_public_context(
                        enriched_row,
                        scraped_metadata=scraped_metadata,
                        sec_fields=sec_fields,
                        mca_fields=mca_fields,
                        linkedin_metadata=linkedin_metadata,
                        website_enrichment=website_enrichment,
                        cb_fields=cb_fields,
                        source_url=website_resolved or normalized_website_val or website_val,
                    )
                    return enriched_row

            tasks = [process_record_safe(idx, rec) for idx, rec in enumerate(input_rows)]
            enriched_records = list(await asyncio.gather(*tasks))

            # OpenAI CDE enrichment for BY Dataset Use Case.
            try:
                from app.services.openai_cde_service import (
                    merge_openai_cde_values,
                    openai_cde_service,
                )

                target_attrs = selected_outputs if selected_outputs else (
                    [key for key in enriched_records[0].keys() if not str(key).startswith("_")]
                    if enriched_records else []
                )

                workflow_ids = []
                if isinstance(config_data, dict) and config_data.get("workflowId"):
                    wf_id = str(config_data["workflowId"])
                    workflow_aliases = {
                        "wf-company-extraction": "company_data",
                        "wf-financial-extraction": "sec_data",
                        "wf-contact-enrichment": "labor_market",
                        "wf-funding": "labor_market",
                        "wf-registry-multi": "registry_data",
                        "wf-news-signals": "company_data",
                    }
                    workflow_ids.append(workflow_aliases.get(wf_id, wf_id))
                if not workflow_ids:
                    workflow_ids = ["company_data"]

                openai_results = await openai_cde_service.extract_dataset_data(
                    records=enriched_records,
                    requested_fields=target_attrs,
                    workflow_ids=workflow_ids,
                )

                ai_rows_with_values = 0
                ai_fields_filled = 0

                for idx, record in enumerate(enriched_records):
                    ai_item = openai_results[idx] if idx < len(openai_results) else {}
                    ai_extracted = ai_item.get("extracted") if isinstance(ai_item, dict) else {}
                    if not isinstance(ai_extracted, dict) or not ai_extracted:
                        continue
                    ai_rows_with_values += 1
                    ai_fields_filled += sum(1 for value in ai_extracted.values() if value not in (None, "", [], {}))
                    enriched_records[idx] = merge_openai_cde_values(
                        record,
                        ai_extracted,
                        requested_fields=target_attrs,
                        source="openai_cde",
                        confidence=80,
                    )

                logger.info(
                    "[OpenAI CDE] job=%s records=%s target_fields=%s rows_with_ai=%s fields_from_ai=%s",
                    job_id,
                    len(enriched_records),
                    len(target_attrs),
                    ai_rows_with_values,
                    ai_fields_filled,
                )

            except Exception as fallback_err:
                logger.warning(f"[OpenAI CDE] Extraction step in demo_routes failed: {fallback_err}")

            sanitized_records = [_strip_internal_keys(record) for record in enriched_records]

            # Wait 5 seconds simulating output file generation & review preparation
            await asyncio.sleep(5)
            
            records_count = len(input_rows)
            freshness_val = random.randint(95, 100)
            now_str = datetime.utcnow().isoformat() + "Z"
            
            next_refresh_str = _calculate_next_refresh_str(frequency)

            history_entry = {
                "timestamp": now_str,
                "records_scraped": records_count,
                "accuracy_rate": freshness_val,
                "status": "Success",
                "execution_time_seconds": random.randint(15, 30)
            }
            
            with get_connection() as conn:
                existing_history_json = conn.execute(
                    "SELECT refresh_history_json FROM scraper_jobs WHERE id = ?",
                    (job_id,)
                ).fetchone()[0]
            
            history = json.loads(existing_history_json or "[]")
            history.append(history_entry)

            with get_connection() as conn:
                conn.execute(
                    """UPDATE scraper_jobs 
                       SET status = 'Review Pending', 
                           records = ?, 
                           fresh = ?, 
                           last_refresh = ?, 
                           next_refresh = ?,
                           refresh_count = refresh_count + 1,
                           refresh_history_json = ?,
                           changes_detected = 0
                       WHERE id = ?""",
                    (records_count, freshness_val, now_str, next_refresh_str, json.dumps(history), job_id)
                )
                conn.commit()
                
            # Write run file
            run_file_dir = os.path.join(BASE_DIR, "datasets")
            run_file_path = os.path.join(run_file_dir, f"{job_id}_run_{refresh_count_curr + 1}.json")
            with open(run_file_path, "w", encoding="utf-8") as f_run:
                json.dump(sanitized_records, f_run, ensure_ascii=False, indent=2)

            from app.services.workflow_service import workflow_service
            workflow_service.runs[job_id] = {
                "run_id": job_id,
                "dataset_id": job_id,
                "dataset_name": source,
                "processed_dataset": sanitized_records
            }
            try:
                from app.services.wcm_comparison_service import warm_review_cache
                asyncio.create_task(warm_review_cache(job_id, 2.0))
            except Exception:
                pass
            return

        if _is_partial_scope(scope) and planner_json:
            partial_result = execute_partial_scrape(
                source_name=source,
                planner_json=planner_json,
            )
            records = partial_result.records
            partial_scrape_metadata = partial_result.execution_metadata

        elif _is_nationalgrid_tso29_source(source):
            await _run_nationalgrid_tso29_job(job_id, source, frequency)
            return
        elif _is_gasunie_demand_prod_source(source):
            await _run_gasunie_demand_prod_job(job_id, source, frequency)
            return
        elif _is_bse_stock_exchange_source(source):
            await _run_bse_stock_exchange_job(job_id, source, frequency)
            return
                    
        else:
            # Custom source/New Source - run onboarding workflow (analyse_site) then scraper
            from app.site_analyzer import analyse_site
            try:
                analyse_site(target_url=source, max_pages=3, strategy="auto")
            except Exception:
                pass
                
            try:
                from app.services.scrapers.website_scraper import fetch_website_metadata
                meta = await fetch_website_metadata(source)
                records = [meta]
            except Exception:
                records = [{
                    "url": source,
                    "title": f"Sample Crawled Title for {source}",
                    "meta_description": "Onboarded and crawled successfully",
                    "emails": ["info@example.com"],
                    "phone_numbers": ["+1 555-0199"],
                    "social_links": [],
                    "detected_company_name": source,
                    "detected_keywords": ["crawled", "verified"],
                    "page_text": "Sample visible page text parsed from company website"
                }]
                
        now_str = datetime.utcnow().isoformat() + "Z"
        
        # Save this clean run dataset to datasets/J-ID_run_N.json
        run_file_dir = os.path.join(BASE_DIR, "datasets")
        os.makedirs(run_file_dir, exist_ok=True)
        next_run_num = max(1, refresh_count_curr + 1)
        run_file_path = os.path.join(run_file_dir, f"{job_id}_run_{next_run_num}.json")
        with open(run_file_path, "w", encoding="utf-8") as f_run:
            json.dump(records, f_run, ensure_ascii=False, indent=2)
            
        # Compute comparisons diff
        total_changes = 0
        comparison_log = {}
        if refresh_count_curr == 0:
            total_changes = len(records)
            comparison_log = {
                "baseline_file": "",
                "current_file": f"{job_id}_run_{next_run_num}.json",
                "records_compared": len(records),
                "added": len(records),
                "modified": 0,
                "deleted": 0,
                "verified": 0,
                "change_percentage": 100.0,
                "modified_details": [],
            }
        else:
            baseline_records, baseline_file = _load_refresh_baseline_records(job_id, run_file_dir, next_run_num)
            comparison_log = _build_refresh_comparison_log(
                source,
                baseline_records,
                records,
                baseline_file=baseline_file,
                current_file=f"{job_id}_run_{next_run_num}.json",
                execution_metadata={},
            )
            total_changes = int(
                (comparison_log.get("added", 0) or 0)
                + (comparison_log.get("modified", 0) or 0)
                + (comparison_log.get("deleted", 0) or 0)
            )
            
        # Write comparison audit log
        comparison_log_path = os.path.join(run_file_dir, f"{job_id}_comparison.json")
        try:
            with open(comparison_log_path, "w", encoding="utf-8") as f_comp:
                json.dump(comparison_log, f_comp, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error("Failed to write comparison log file: %s", e)

        # Recalculate next refresh date
        next_refresh_str = _calculate_next_refresh_str(frequency)
        
        history_entry = {
            "timestamp": now_str,
            "records_scraped": len(records),
            "accuracy_rate": 100,
            "status": "Success",
            "execution_time_seconds": random.randint(15, 30)
        }
        
        with get_connection() as conn:
            existing_history_json = conn.execute(
                "SELECT refresh_history_json FROM scraper_jobs WHERE id = ?",
                (job_id,)
            ).fetchone()[0]
        
        history = json.loads(existing_history_json or "[]")
        history.append(history_entry)
        
        with get_connection() as conn:
            conn.execute(
                """UPDATE scraper_jobs 
                   SET status = 'Review Pending', 
                       records = ?, 
                       fresh = 100, 
                       last_refresh = ?, 
                       next_refresh = ?,
                       refresh_count = ?,
                       refresh_history_json = ?,
                       changes_detected = ?
                   WHERE id = ?""",
                (len(records), now_str, next_refresh_str, next_run_num, json.dumps(history), total_changes, job_id)
            )
            conn.commit()
            
        from app.services.workflow_service import workflow_service
        workflow_service.runs[job_id] = {
            "run_id": job_id,
            "dataset_id": job_id,
            "dataset_name": source,
            "processed_dataset": records,
            "partial_scrape_metadata": partial_scrape_metadata or None,
        }
        try:
            from app.services.wcm_comparison_service import warm_review_cache
            asyncio.create_task(warm_review_cache(job_id, 2.0))
        except Exception:
            pass
        return
    except Exception as e:
        import traceback
        traceback.print_exc()
        with get_connection() as conn:
            conn.execute(
                "UPDATE scraper_jobs SET status = 'Failed', fresh = 0 WHERE id = ?",
                (job_id,)
            )
            conn.commit()


@router.post("/jobs/launch")
async def launch_jobs(request: Request, payload: LaunchJobsRequest, background_tasks: BackgroundTasks):
    session = auth_service.get_session(request)
    owner_username = (session or {}).get("username") or "user"
    for item in payload.jobs:
        raw_partial_request = (item.custom_criteria or "").strip()
        if _is_partial_scope(item.scope) and not raw_partial_request and (item.filters.strip().startswith("{") or "=" in item.filters):
            raw_partial_request = item.filters.strip()

        planner_json_value: Optional[str] = None
        effective_filters = item.filters.strip() if item.filters and item.filters.strip() else "—"
        if _is_partial_scope(item.scope) and raw_partial_request:
            capability = get_partial_scrape_capability(item.source)
            if capability is None:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "source": item.source,
                        "status": "unsupported",
                        "execution_summary": f"Partial Scrape is not configured for {item.source}.",
                        "clarification_required": [],
                        "unsupported_reason": "No capability profile is registered for this source.",
                    },
                )
            plan_result = partial_scrape_planner_service.plan_partial_scrape(
                source_name=item.source,
                user_request=raw_partial_request,
            )
            if hasattr(plan_result, "model_dump"):
                plan_payload = plan_result.model_dump(mode="json")
            else:
                plan_payload = plan_result.dict()
            planner_json_value = json.dumps(plan_payload, ensure_ascii=False, default=str)
            if plan_result.feedback.status != "supported":
                raise HTTPException(
                    status_code=422,
                    detail=plan_payload["feedback"] | {
                        "source": item.source,
                        "planner_metadata": plan_payload["planner_metadata"],
                        "execution_plan": plan_payload["execution_plan"],
                    },
                )

        with get_connection() as conn:
            exists = conn.execute("SELECT 1 FROM scraper_jobs WHERE id = ?", (item.id,)).fetchone()
        
        if item.input_data is not None:
            input_file_dir = os.path.join(BASE_DIR, "datasets")
            os.makedirs(input_file_dir, exist_ok=True)
            input_file_path = os.path.join(input_file_dir, f"{item.id}_input.json")
            with open(input_file_path, "w", encoding="utf-8") as f_in:
                json.dump(item.input_data, f_in, ensure_ascii=False, indent=2)
        
        clean_src = "".join(ch if ch.isalnum() else "_" for ch in item.source.lower())
        dataset_path = f"datasets/{clean_src}_sample.csv"
        now_str = datetime.utcnow().isoformat() + "Z"
        
        next_refresh_str = _calculate_next_refresh_str(item.frequency)

        # Look up complexity and SLA from pending jobs with status = 'Analysis Complete' as a fallback if not passed
        complexity_val = item.complexity
        sla_val = item.estimated_onboarding_time
        if not complexity_val or not sla_val:
            try:
                with get_connection() as conn:
                    row_p = conn.execute(
                        "SELECT complexity, estimated_onboarding_time FROM scraper_jobs WHERE source = ? AND (status = 'Analysis Complete' OR status = 'Pending Onboarding') LIMIT 1",
                        (item.source,)
                    ).fetchone()
                    if row_p:
                        if not complexity_val:
                            complexity_val = row_p[0]
                        if not sla_val:
                            sla_val = row_p[1]
            except Exception:
                pass

        status_val = "Pending Onboarding" if bool(item.isCustomSource) or _is_partial_scope(item.scope) else "Running"

        try:
            if not (_is_nationalgrid_tso29_source(item.source) or _is_gasunie_demand_prod_source(item.source)):
                with get_connection() as conn:
                    conn.execute(
                        "UPDATE scraper_jobs SET status = 'Failed' WHERE source = ? AND status = 'Running' AND id != ?",
                        (item.source, item.id)
                    )
                    conn.commit()
        except Exception:
            pass

        if exists:
            with get_connection() as conn:
                conn.execute(
                    """UPDATE scraper_jobs
                       SET source = ?, scope = ?, filters = ?, custom_criteria = ?, planner_json = ?, frequency = ?, delivery = ?,
                           output_format = ?, dataset_path = ?, status = ?, 
                           created_at = ?, next_refresh = ?, is_custom_source = ?, mode = ?,
                           complexity = ?, estimated_onboarding_time = ?, records = ?
                       WHERE id = ?""",
                    (item.source, item.scope, effective_filters, raw_partial_request or item.custom_criteria or "—", planner_json_value, item.frequency, item.delivery,
                     item.output_format, dataset_path, status_val, now_str, next_refresh_str,
                     1 if item.isCustomSource else 0, item.mode, complexity_val, sla_val, item.records, item.id)
                )
                conn.commit()
        else:
            with get_connection() as conn:
                conn.execute(
                    """INSERT INTO scraper_jobs (id, source, scope, filters, custom_criteria, frequency, delivery, 
                                                 output_format, dataset_path, status, created_at, next_refresh, 
                                                 is_custom_source, mode, complexity, estimated_onboarding_time, records, planner_json)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (item.id, item.source, item.scope, effective_filters, raw_partial_request or item.custom_criteria or "—", item.frequency, item.delivery,
                     item.output_format, dataset_path, status_val, now_str, next_refresh_str,
                     1 if item.isCustomSource else 0, item.mode, complexity_val, sla_val, item.records, planner_json_value)
                )
                conn.commit()

        try:
            with get_connection() as conn:
                conn.execute(
                    "UPDATE scraper_jobs SET owner_username = ? WHERE id = ?",
                    (owner_username, item.id),
                )
                conn.commit()
        except Exception:
            pass
        
        # Delete pending job to prevent duplicates
        try:
            with get_connection() as conn:
                conn.execute(
                    "DELETE FROM scraper_jobs WHERE source = ? AND id != ? AND (status = 'Analysis Complete' OR status = 'Pending Onboarding')",
                    (item.source, item.id)
                )
                conn.commit()
        except Exception:
            pass
        
        background_tasks.add_task(run_scraper_background, item.id)
        
    return {"status": "success", "launched_count": len(payload.jobs)}


@router.post("/jobs/create_pending")
async def create_pending_job(request: Request, item: PendingJobItem):
    import random
    job_id = f"J-{random.randint(1000, 9999)}"
    now_str = datetime.utcnow().isoformat() + "Z"
    status = "Pending Onboarding"
    session = auth_service.get_session(request)
    owner_username = (session or {}).get("username") or "user"
    
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO scraper_jobs (id, source, scope, filters, custom_criteria, frequency, delivery, 
                                        output_format, dataset_path, status, created_at, is_custom_source, mode, complexity, estimated_onboarding_time)
               VALUES (?, ?, 'Full Dump', '—', '—', 'Weekly', 'S3 bucket', 'JSON', ?, ?, ?, 1, 'Site-Specific', ?, ?)""",
            (job_id, item.website_url, f"datasets/{item.source_name.lower()}_sample.csv", status, now_str, item.complexity, item.estimated_development_effort)
        )
        conn.commit()
    try:
        with get_connection() as conn:
            conn.execute(
                "UPDATE scraper_jobs SET owner_username = ? WHERE id = ?",
                (owner_username, job_id),
            )
            conn.commit()
    except Exception:
        pass
    return {"status": "success", "job_id": job_id}


@router.get("/jobs")
async def get_jobs(request: Request):
    session = auth_service.get_session(request)
    if not session:
        return []
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM scraper_jobs").fetchall()
    if session.get("role") != "admin":
        username = session.get("username")
        rows = [
            r for r in rows
            if str(r["owner_username"] or "") == username or (r["owner_username"] is None and username == "user")
        ]
    
    jobs = []
    for r in rows:
        try:
            history = []
            if r["refresh_history_json"]:
                try:
                    history = json.loads(r["refresh_history_json"])
                except Exception:
                    history = []

            def as_text(value, default=""):
                if value is None:
                    return default
                if isinstance(value, str):
                    return value
                return str(value)

            # Dynamically load the records count from input/run JSON file if it exists for By Dataset
            job_id = as_text(r["id"])
            records_count = r["records"]
            job_mode = as_text(r["mode"])
            if job_mode in ("By Dataset", "Any-Site"):
                from app.services.workflow_service import workflow_service
                in_mem_run = workflow_service.runs.get(job_id)
                if in_mem_run and in_mem_run.get("processed_dataset"):
                    records_count = len(in_mem_run["processed_dataset"])
                else:
                    ref_count = r["refresh_count"] or 1
                    run_file = os.path.join(BASE_DIR, "datasets", f"{job_id}_run_{ref_count}.json")
                    if not os.path.exists(run_file):
                        run_file = os.path.join(BASE_DIR, "datasets", f"{job_id}_run_1.json")
                    input_file = os.path.join(BASE_DIR, "datasets", f"{job_id}_input.json")
                    if os.path.exists(run_file):
                        try:
                            with open(run_file, "r", encoding="utf-8") as f:
                                records_count = len(json.load(f))
                        except Exception:
                            pass
                    elif os.path.exists(input_file):
                        try:
                            with open(input_file, "r", encoding="utf-8") as f:
                                records_count = len(json.load(f))
                        except Exception:
                            pass

            # Count decisions if they exist
            approved_count = None
            rejected_count = None
            decisions_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_review_decisions.json")
            if os.path.exists(decisions_path):
                try:
                    with open(decisions_path, "r", encoding="utf-8") as f_dec:
                        decisions = json.load(f_dec)
                        if isinstance(decisions, list):
                            approved_count = sum(1 for d in decisions if isinstance(d, dict) and d.get("reviewer_action") == "accepted")
                            rejected_count = sum(1 for d in decisions if isinstance(d, dict) and d.get("reviewer_action") == "rejected")
                except Exception:
                    pass

            # Calculate coverage and review summary dynamically
            coverage = None
            try:
                from app.services.wcm_comparison_service import build_review_coverage
                coverage = build_review_coverage(
                    job_id=job_id,
                    source=r["source"],
                    mode=r["mode"],
                    scope=r["scope"],
                    filters_str=r["filters"],
                    refresh_count=r["refresh_count"],
                )
                from app.services.wcm_comparison_service import compact_review_coverage
                coverage = compact_review_coverage(coverage)
            except Exception as e:
                logger.warning("Failed to compute coverage for job %s: %s", job_id, e)

            review_summary = None
            try:
                from app.services.wcm_comparison_service import get_job_review_summary
                review_summary = get_job_review_summary(job_id)
            except Exception as e:
                pass

            jobs.append({
                "id": job_id,
                "source": as_text(r["source"]),
                "scope": as_text(r["scope"]),
                "filters": as_text(r["filters"], "â€”"),
                "custom_criteria": as_text(r["custom_criteria"], "â€”"),
                "frequency": as_text(r["frequency"], "Weekly"),
                "delivery": as_text(r["delivery"], "S3 bucket"),
                "output_format": as_text(r["output_format"], "JSON"),
                "dataset_path": as_text(r["dataset_path"]),
                "status": as_text(r["status"], "Failed"),
                "records": records_count,
                "fresh": r["fresh"],
                "created_at": r["created_at"],
                "last_refresh": r["last_refresh"],
                "next_refresh": r["next_refresh"],
                "refresh_count": r["refresh_count"],
                "isCustomSource": bool(r["is_custom_source"]),
                "mode": job_mode or "Site-Specific",
                "changes_detected": r["changes_detected"] if "changes_detected" in r.keys() else 0,
                "refresh_history": history,
                "complexity": r["complexity"] if "complexity" in r.keys() else None,
                "estimated_onboarding_time": r["estimated_onboarding_time"] if "estimated_onboarding_time" in r.keys() else None,
                "approved_count": approved_count,
                "rejected_count": rejected_count,
                "coverage": coverage,
                "review_summary": review_summary,
                "is_urgent": bool(r["is_urgent"]),
            })
        except Exception as e:
            logger.warning("Skipping malformed scraper job row %s: %s", r["id"] if "id" in r.keys() else "unknown", e)
    return jobs


class EditValueRequest(BaseModel):
    job_id: str
    record_index: int
    attribute: str
    value: str

@router.post("/jobs/edit_value")
async def edit_value(req: EditValueRequest):
    import logging
    logger = logging.getLogger(__name__)
    job_id = req.job_id
    record_index = req.record_index
    attribute = req.attribute
    value = req.value
    
    # 1. Update in-memory workspace runs if present
    from app.services.workflow_service import workflow_service
    in_mem_run = workflow_service.runs.get(job_id)
    if in_mem_run and in_mem_run.get("processed_dataset"):
        dataset = in_mem_run["processed_dataset"]
        if 0 <= record_index < len(dataset):
            dataset[record_index][attribute] = value if value != "—" else None
            
    # 2. Update DB/file state to persist it
    with get_connection() as conn:
        row = conn.execute("SELECT mode, refresh_count FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
    
    mode = row[0] if row else "By Dataset"
    refresh_count = row[1] if row else 1
    if refresh_count == 0:
        refresh_count = 1
        
    run_file_dir = os.path.join(BASE_DIR, "datasets")
    if mode in ("By Dataset", "Any-Site"):
        run_file_path = os.path.join(run_file_dir, f"{job_id}_run_{refresh_count}.json")
        if not os.path.exists(run_file_path):
            run_file_path = os.path.join(run_file_dir, f"{job_id}_run_1.json")
    else:
        run_file_path = os.path.join(run_file_dir, f"{job_id}_run_{refresh_count}.json")
    
    if os.path.exists(run_file_path):
        try:
            with open(run_file_path, "r", encoding="utf-8") as f:
                records = json.load(f)
            if 0 <= record_index < len(records):
                records[record_index][attribute] = value if value != "—" else None
            with open(run_file_path, "w", encoding="utf-8") as f:
                json.dump(records, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error("Failed to edit persisted JSON file: %s", e)
            raise HTTPException(status_code=500, detail=f"Failed to update dataset file: {str(e)}")
            
    coverage = None
    review_summary = None
    try:
        from app.services.wcm_comparison_service import get_review_rows, get_job_review_summary

        coverage = get_review_rows(job_id, 100.0, include_coverage=True).get("coverage")
        review_summary = get_job_review_summary(job_id)
    except Exception as exc:
        logger.warning("Failed to refresh review payload after edit for %s: %s", job_id, exc)

    return {
        "status": "success",
        "coverage": coverage,
        "review_summary": review_summary,
    }


# Confidence report preview route has been removed.


@router.get("/jobs/review_data")
async def get_jobs_review_data(job_id: str, sample_rate: float = 2.0, sample_offset: int = 0):
    from app.services.wcm_comparison_service import get_review_rows
    try:
        data = get_review_rows(job_id, sample_rate, sample_offset=sample_offset)
        return data
    except Exception as e:
        logger.error("Failed to get review data: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to fetch review data: {str(e)}")


class ReviewDecisionItem(BaseModel):
    record_index: int
    attribute: str
    previous_value: Optional[str] = None
    enriched_value: Optional[str] = None
    admv_status: str
    reviewer_action: str

class SubmitReviewRequest(BaseModel):
    job_id: str
    decisions: List[ReviewDecisionItem]

@router.post("/jobs/submit_review")
async def submit_review(req: SubmitReviewRequest):
    import logging
    logger = logging.getLogger(__name__)
    job_id = req.job_id
    
    # 1. Save the reviewer decisions to datasets/{job_id}_review_decisions.json
    decisions_dir = os.path.join(BASE_DIR, "datasets")
    os.makedirs(decisions_dir, exist_ok=True)
    decisions_path = os.path.join(decisions_dir, f"{job_id}_review_decisions.json")
    
    decisions_list = [d.dict() for d in req.decisions]
    try:
        with open(decisions_path, "w", encoding="utf-8") as f_dec:
            json.dump(decisions_list, f_dec, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error("Failed to write review decisions file: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to save decisions: {str(e)}")

    # 2. Retrieve scraper_job metadata
    try:
        with get_connection() as conn:
            row = conn.execute("SELECT filters, mode, refresh_count, source FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Job not found")
        filters_str, mode, refresh_count, source = row
        config = json.loads(filters_str) if filters_str and filters_str != "—" else {}
    except Exception as e:
        logger.error("Failed to query DB: %s", e)
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    if mode in ("By Dataset", "Any-Site"):
        mapping = config.get("mapping") or {}
        selected_outputs = config.get("selectedOutputs") or []
        # Load input rows and scraped records
        input_file_path = os.path.join(decisions_dir, f"{job_id}_input.json")
        final_file_path = os.path.join(decisions_dir, f"{job_id}_final.json")
        if refresh_count > 1 and os.path.exists(final_file_path):
            input_file_path = final_file_path

        run_file_path = os.path.join(decisions_dir, f"{job_id}_run_{refresh_count}.json")
        if not os.path.exists(run_file_path):
            run_file_path = os.path.join(decisions_dir, f"{job_id}_run_1.json")

        input_records = []
        scraped_records = []

        if os.path.exists(input_file_path):
            try:
                with open(input_file_path, "r", encoding="utf-8") as f:
                    input_records = json.load(f)
            except Exception:
                pass

        if os.path.exists(run_file_path):
            try:
                with open(run_file_path, "r", encoding="utf-8") as f:
                    scraped_records = json.load(f)
            except Exception:
                pass

        if not scraped_records:
            raise HTTPException(status_code=400, detail="No enriched run data found to finalize")

        def is_empty(v):
            if v is None:
                return True
            s = str(v).strip()
            return s in ("", "-", "—")

        def get_final_value(prev_val, enriched_val, admv_status, action):
            if admv_status == "A":
                if action == "rejected":
                    return None
                else:
                    return enriched_val if not is_empty(enriched_val) else None
            elif admv_status == "D":
                if action == "rejected":
                    return prev_val if not is_empty(prev_val) else None
                else:
                    return None
            elif admv_status == "M":
                if action == "rejected":
                    return prev_val if not is_empty(prev_val) else None
                else:
                    return enriched_val if not is_empty(enriched_val) else None
            else:
                return enriched_val if not is_empty(enriched_val) else None

        def determine_admv_fallback(prev, newVal):
            def clean_value(v):
                if v is None:
                    return ""
                s = str(v).strip()
                if s in ("", "-", "—"):
                    return ""
                return s
            p = clean_value(prev)
            n = clean_value(newVal)
            if p == "" and n == "":
                return "V"
            if p == "" and n != "":
                return "A"
            if p != "" and n == "":
                return "D"
            if p.lower() == n.lower():
                return "V"
            return "M"

        final_records = []
        for i in range(len(scraped_records)):
            original_rec = input_records[i] if i < len(input_records) else {}
            scraped_rec = scraped_records[i]
            
            final_rec = {}
            for attr in selected_outputs:
                decision = next((d for d in req.decisions if d.record_index == i and d.attribute == attr), None)
                
                mapped_header = mapping.get(attr)
                raw_prev = original_rec.get(mapped_header) if mapped_header else original_rec.get(attr)
                raw_new = scraped_rec.get(attr)
                
                if decision:
                    admv = decision.admv_status
                    action = decision.reviewer_action.lower()
                else:
                    admv = determine_admv_fallback(raw_prev, raw_new)
                    action = "accepted"
                    
                final_val = get_final_value(raw_prev, raw_new, admv, action)
                final_rec[attr] = final_val
                
            final_records.append(final_rec)

    else:
        # By Source (Site-Specific) Review Submission
        # Load latest run
        current_run_num = _latest_run_number_for_job(job_id, refresh_count)
        if current_run_num <= 0:
            current_run_num = 1
        run_file_path = os.path.join(decisions_dir, f"{job_id}_run_{current_run_num}.json")
        new_records = []
        if os.path.exists(run_file_path):
            try:
                with open(run_file_path, "r", encoding="utf-8") as f:
                    new_records = json.load(f)
            except Exception:
                pass

        # Load baseline
        baseline_records, _ = _load_refresh_baseline_records(job_id, decisions_dir, current_run_num)

        # Align records
        from app.api.demo_routes import get_record_key
        baseline_map = {}
        for idx, r in enumerate(baseline_records):
            key = get_record_key(source, r)
            if not key or key.strip() == "":
                key = f"idx_{idx}"
            orig_key = key
            counter = 1
            while key in baseline_map:
                key = f"{orig_key}_{counter}"
                counter += 1
            baseline_map[key] = r

        new_map = {}
        for idx, r in enumerate(new_records):
            key = get_record_key(source, r)
            if not key or key.strip() == "":
                key = f"idx_{idx}"
            orig_key = key
            counter = 1
            while key in new_map:
                key = f"{orig_key}_{counter}"
                counter += 1
            new_map[key] = r

        ordered_keys = []
        for k in new_map.keys():
            ordered_keys.append(k)
        for k in baseline_map.keys():
            if k not in new_map:
                ordered_keys.append(k)

        all_attrs = set()
        for r in new_map.values():
            all_attrs.update(r.keys())
        for r in baseline_map.values():
            all_attrs.update(r.keys())
        exclude_keys = {"id", "run_id", "timestamp", "scraped_at", "created_at"}
        attrs = sorted([a for a in all_attrs if a not in exclude_keys])

        decisions_dict = {}
        for d in req.decisions:
            decisions_dict[(d.record_index, d.attribute)] = d.reviewer_action.lower()

        final_records = []
        for idx, k in enumerate(ordered_keys):
            new_val_exists = k in new_map
            baseline_val_exists = k in baseline_map

            # Handle deleted record
            if baseline_val_exists and not new_val_exists:
                keep_record = False
                for attr in attrs:
                    action = decisions_dict.get((idx, attr), "accepted")
                    if action == "rejected":
                        keep_record = True
                        break
                if keep_record:
                    final_records.append(baseline_map[k])
                continue

            final_rec = {}
            base_rec = new_map[k] if new_val_exists else baseline_map[k]
            for sys_key in exclude_keys:
                if sys_key in base_rec:
                    final_rec[sys_key] = base_rec[sys_key]

            def clean_value(v):
                if v is None:
                    return ""
                s = str(v).strip()
                if s in ("", "-", "—"):
                    return ""
                return s

            for attr in attrs:
                prev_val = baseline_map[k].get(attr) if baseline_val_exists else None
                new_val = new_map[k].get(attr) if new_val_exists else None
                
                action = decisions_dict.get((idx, attr), "accepted")
                
                p_str = clean_value(prev_val)
                n_str = clean_value(new_val)
                
                if p_str == "" and n_str == "":
                    admv = "V"
                elif p_str == "" and n_str != "":
                    admv = "A"
                elif p_str != "" and n_str == "":
                    admv = "D"
                elif p_str.lower() == n_str.lower():
                    admv = "V"
                else:
                    admv = "M"

                if admv == "A":
                    final_val = new_val if action == "accepted" else None
                elif admv == "D":
                    final_val = None if action == "accepted" else prev_val
                elif admv == "M":
                    final_val = new_val if action == "accepted" else prev_val
                else:
                    final_val = new_val if new_val is not None else prev_val
                
                final_rec[attr] = final_val if final_val is not None else ""
                
            if not baseline_val_exists:
                has_any_val = False
                for attr in attrs:
                    val = final_rec.get(attr)
                    if val is not None and str(val).strip() not in ("", "-", "—"):
                        has_any_val = True
                        break
                if not has_any_val:
                    continue

            final_records.append(final_rec)

    # Save final dataset
    final_path = os.path.join(decisions_dir, f"{job_id}_final.json")
    try:
        with open(final_path, "w", encoding="utf-8") as f_fin:
            json.dump(final_records, f_fin, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error("Failed to write final reviewed dataset file: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to save final export file: {str(e)}")

    # Update SQLite status to 'Completed' and increment refresh_count if not By Dataset
    try:
        with get_connection() as conn:
            if mode in ("By Dataset", "Any-Site"):
                conn.execute("UPDATE scraper_jobs SET status = 'Completed' WHERE id = ?", (job_id,))
            else:
                conn.execute("UPDATE scraper_jobs SET status = 'Completed', refresh_count = refresh_count + 1 WHERE id = ?", (job_id,))
            conn.commit()
    except Exception as e:
        logger.error("Failed to update database status: %s", e)
        raise HTTPException(status_code=500, detail=f"Database update failed: {str(e)}")

    return {"status": "success"}


@router.get("/jobs/{job_id}/review_summary")
async def get_job_review_summary_endpoint(job_id: str):
    from app.services.wcm_comparison_service import get_job_review_summary
    try:
        summary = get_job_review_summary(job_id)
        return summary
    except Exception as e:
        logger.error("Failed to get review summary for job %s: %s", job_id, e)
        raise HTTPException(status_code=500, detail=f"Failed to fetch review summary: {str(e)}")


class ToggleUrgentRequest(BaseModel):
    is_urgent: bool


@router.post("/jobs/{job_id}/urgent")
async def toggle_job_urgent(job_id: str, req: ToggleUrgentRequest):
    try:
        val = 1 if req.is_urgent else 0
        with get_connection() as conn:
            conn.execute("UPDATE scraper_jobs SET is_urgent = ? WHERE id = ?", (val, job_id))
            conn.commit()
        return {"status": "success", "is_urgent": req.is_urgent}
    except Exception as e:
        logger.error("Failed to toggle urgent status for job %s: %s", job_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    try:
        with get_connection() as conn:
            result = conn.execute("DELETE FROM scraper_jobs WHERE id = ?", (job_id,))
            conn.commit()
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Job not found")
        return {"status": "success", "job_id": job_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to delete job %s: %s", job_id, e)
        raise HTTPException(status_code=500, detail=str(e))
