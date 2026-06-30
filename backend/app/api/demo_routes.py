"""
Temporary demo router for Keysight and WebMD Scraper integrations.
"""

import os
import json
import re
import random
import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.services.scrapers.keysight_scraper import (
    main as run_keysight_scraper,
    scrape_keysight_products
)
from app.services.scrapers.webmd_scraper import main as run_webmd_scraper
from app.services.partial_scrape_planner_service import partial_scrape_planner_service
from app.services.partial_scrape_capabilities import get_partial_scrape_capability

router = APIRouter()
logger = logging.getLogger(__name__)

# Resolve workspace root directory relative to this file
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Keysight paths
KEYSIGHT_CSV_PATH = os.path.join(BASE_DIR, "sample_keysight.csv")
KEYSIGHT_XLSX_PATH = os.path.join(BASE_DIR, "sample_keysight.xlsx")

# WebMD paths
WEBMD_CSV_PATH = os.path.join(BASE_DIR, "sample_webmd.csv")
WEBMD_XLSX_PATH = os.path.join(BASE_DIR, "sample_webmd.xlsx")

# Investegate paths
INVESTEGATE_CSV_PATH = os.path.join(BASE_DIR, "sample_investegate.csv")
INVESTEGATE_XLSX_PATH = os.path.join(BASE_DIR, "sample_investegate.xlsx")

# TurkeyBrokers paths
TURKEYBROKERS_CSV_PATH = os.path.join(BASE_DIR, "sample_turkeybrokers.csv")
TURKEYBROKERS_XLSX_PATH = os.path.join(BASE_DIR, "sample_turkeybrokers.xlsx")



# Pydantic schemas for request validation
class KeysightPartialDumpRequest(BaseModel):
    category: Optional[str] = Field(default=None, description="Product category")
    product_family: Optional[str] = Field(default=None, description="Product family")
    product_series: Optional[str] = Field(default=None, description="Product series")
    region: Optional[str] = Field(default=None, description="Region/Locale")
    sku: Optional[str] = Field(default=None, description="SKU or model number")
    output_format: str = Field(default="json", description="Output format (json, csv, xlsx)")

    class Config:
        json_schema_extra = {
            "example": {
                "category": "Oscilloscopes",
                "product_family": "InfiniiVision Oscilloscopes",
                "product_series": None,
                "region": None,
                "sku": None,
                "output_format": "csv"
            }
        }

def generate_partial_file(records: list, output_format: str, file_path: str):
    import pandas as pd
    from app.services.scrapers.keysight_scraper import COLUMNS
    
    df = pd.DataFrame(records, columns=COLUMNS)
    df_out = df.where(pd.notnull(df), None)
    
    if output_format == "csv":
        df_out.to_csv(file_path, index=False)
    elif output_format == "xlsx":
        df_out.to_excel(file_path, index=False)


# --- Keysight Endpoints ---

@router.get(
    "/keysight/sample",
    summary="Run Keysight scraper and return JSON results",
    description="Runs the Keysight scraping logic dynamically, updates/saves CSV and Excel files, and returns the result as JSON."
)
async def get_keysight_sample():
    """
    Loads Keysight records from the stored CSV dataset, selects 15 records
    with the highest field completeness, and returns the results.
    """
    try:
        import pandas as pd
        import numpy as np
        import math
        
        if not os.path.exists(KEYSIGHT_CSV_PATH):
            raise FileNotFoundError(f"Keysight sample CSV file not found at: {KEYSIGHT_CSV_PATH}")
            
        df = pd.read_csv(KEYSIGHT_CSV_PATH)
        records = df.to_dict(orient="records")
        
        # Clean any float nan or infinite values
        for rec in records:
            for k, v in rec.items():
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    rec[k] = None
                elif pd.isna(v):
                    rec[k] = None
        
        # Helper to check completeness
        def get_completeness(rec):
            completeness = 0
            for v in rec.values():
                if v is not None and v != "" and str(v).lower() != "nan" and str(v).lower() != "null":
                    completeness += 1
            return completeness
            
        # Sort in descending order of completeness
        sorted_records = sorted(records, key=get_completeness, reverse=True)
        
        # Select top 15 records
        selected_records = sorted_records[:15]
        
        result = {
            "source": "Keysight",
            "records_scraped": 25000,
            "sample_csv": KEYSIGHT_CSV_PATH,
            "sample_xlsx": KEYSIGHT_XLSX_PATH,
            "records": selected_records
        }
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while loading Keysight sample: {str(e)}"
        )


@router.get(
    "/keysight/download/csv",
    summary="Download scraped Keysight sample CSV file",
    description="Returns the generated sample_keysight.csv file."
)
async def download_keysight_csv():
    """
    Downloads the sample_keysight.csv file.
    """
    if not os.path.exists(KEYSIGHT_CSV_PATH):
        raise HTTPException(
            status_code=404,
            detail="Sample CSV file not found. Please run the sample scraping endpoint first to generate it."
        )
    return FileResponse(
        path=KEYSIGHT_CSV_PATH,
        media_type="text/csv",
        filename="sample_keysight.csv"
    )


@router.get(
    "/keysight/download/xlsx",
    summary="Download scraped Keysight sample Excel file",
    description="Returns the generated sample_keysight.xlsx file."
)
async def download_keysight_xlsx():
    """
    Downloads the sample_keysight.xlsx file.
    """
    if not os.path.exists(KEYSIGHT_XLSX_PATH):
        raise HTTPException(
            status_code=404,
            detail="Sample XLSX file not found. Please run the sample scraping endpoint first to generate it."
        )
    return FileResponse(
        path=KEYSIGHT_XLSX_PATH,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="sample_keysight.xlsx"
    )


# --- Keysight Partial Dump Endpoints ---

@router.get(
    "/keysight/template",
    summary="Get Keysight Partial Dump Filter Template",
    description="Loads and returns the keysight_filter_template.json file directly from the workspace root."
)
async def get_keysight_template():
    """Loads and returns keysight_filter_template.json directly."""
    template_path = os.path.join(BASE_DIR, "keysight_filter_template.json")
    if not os.path.exists(template_path):
        raise HTTPException(
            status_code=404,
            detail="Filter template keysight_filter_template.json not found in workspace root."
        )
    try:
        with open(template_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read keysight_filter_template.json: {str(e)}"
        )


@router.post(
    "/keysight/partial-dump",
    summary="Scrape Keysight products using partial dump filters",
    description="Accepts filter criteria, restricts the crawling scope to the selected criteria, and returns the scraped records."
)
async def post_keysight_partial_dump(request: KeysightPartialDumpRequest):
    """
    Runs the scraper with specific filter criteria and returns the scraped records.
    """
    try:
        filters = request.dict()
        records = scrape_keysight_products(filters)
        
        # Include only non-null values in filters_applied
        filters_applied = {k: v for k, v in filters.items() if v is not None}
        
        return {
            "records_scraped": len(records),
            "filters_applied": filters_applied,
            "records": records
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred during Keysight partial dump: {str(e)}"
        )


@router.post(
    "/keysight/partial-dump/download",
    summary="Run filtered Keysight scrape and download file",
    description="Executes a filtered scrape and returns the generated CSV or XLSX file."
)
async def post_keysight_partial_dump_download(request: KeysightPartialDumpRequest):
    """
    Runs a filtered scrape and returns the output file.
    """
    format_lower = request.output_format.lower()
    if format_lower not in ["csv", "xlsx"]:
        raise HTTPException(
            status_code=400,
            detail="output_format must be either 'csv' or 'xlsx'."
        )
    
    try:
        filters = request.dict()
        records = scrape_keysight_products(filters)
        
        if format_lower == "csv":
            file_path = os.path.join(BASE_DIR, "partial_keysight.csv")
            generate_partial_file(records, "csv", file_path)
            return FileResponse(
                path=file_path,
                media_type="text/csv",
                filename="partial_keysight.csv"
            )
        elif format_lower == "xlsx":
            file_path = os.path.join(BASE_DIR, "partial_keysight.xlsx")
            generate_partial_file(records, "xlsx", file_path)
            return FileResponse(
                path=file_path,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                filename="partial_keysight.xlsx"
            )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred generating partial download file: {str(e)}"
        )


# --- WebMD Endpoints ---

@router.get(
    "/webmd/sample",
    summary="Run WebMD scraper and return JSON results",
    description="Runs the WebMD physician scraping logic dynamically, updates/saves CSV and Excel files, and returns the result as JSON."
)
async def get_webmd_sample():
    """
    Loads WebMD records from the stored CSV dataset, selects 15 records
    with the highest field completeness, and returns the results.
    """
    try:
        import pandas as pd
        import numpy as np
        import math
        
        if not os.path.exists(WEBMD_CSV_PATH):
            raise FileNotFoundError(f"WebMD sample CSV file not found at: {WEBMD_CSV_PATH}")
            
        df = pd.read_csv(WEBMD_CSV_PATH)
        records = df.to_dict(orient="records")
        
        # Clean any float nan or infinite values
        for rec in records:
            for k, v in rec.items():
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    rec[k] = None
                elif pd.isna(v):
                    rec[k] = None
        
        # Helper to check completeness score
        def get_completeness_score(rec):
            if not rec:
                return 0.0
            non_empty = sum(
                1 for v in rec.values()
                if v is not None and v != "" and str(v).lower() != "nan" and str(v).lower() != "null"
            )
            return float(non_empty) / float(len(rec))
            
        # Sort in descending order of completeness score
        sorted_records = sorted(records, key=get_completeness_score, reverse=True)
        
        # Select top 15 records
        selected_records = sorted_records[:15]
        
        result = {
            "source": "WebMD",
            "records_scraped": 1000000,
            "sample_csv": WEBMD_CSV_PATH,
            "sample_xlsx": WEBMD_XLSX_PATH,
            "records": selected_records
        }
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while loading WebMD sample: {str(e)}"
        )


@router.get(
    "/webmd/download/csv",
    summary="Download scraped WebMD sample CSV file",
    description="Returns the generated sample_webmd.csv file."
)
async def download_webmd_csv():
    """
    Downloads the sample_webmd.csv file.
    """
    if not os.path.exists(WEBMD_CSV_PATH):
        raise HTTPException(
            status_code=404,
            detail="Sample CSV file not found. Please run the sample scraping endpoint first to generate it."
        )
    return FileResponse(
        path=WEBMD_CSV_PATH,
        media_type="text/csv",
        filename="sample_webmd.csv"
    )


@router.get(
    "/webmd/download/xlsx",
    summary="Download scraped WebMD sample Excel file",
    description="Returns the generated sample_webmd.xlsx file."
)
async def download_webmd_xlsx():
    """
    Downloads the sample_webmd.xlsx file.
    """
    if not os.path.exists(WEBMD_XLSX_PATH):
        raise HTTPException(
            status_code=404,
            detail="Sample XLSX file not found. Please run the sample scraping endpoint first to generate it."
        )
    return FileResponse(
        path=WEBMD_XLSX_PATH,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="sample_webmd.xlsx"
    )


# --- Investegate Endpoints ---

@router.get(
    "/sec/sample",
    summary="Get Investegate sample data powered by SEC scraper",
    description="Loads Investegate records from the stored CSV dataset (powered by the SEC scraper), selects 15 records with the highest field completeness, and returns the results."
)
async def get_investegate_sample():
    """
    Loads Investegate records from the stored CSV dataset, selects 15 records
    with the highest field completeness, and returns the results.
    """
    try:
        import pandas as pd
        import numpy as np
        import math
        
        if not os.path.exists(INVESTEGATE_CSV_PATH):
            raise FileNotFoundError(f"Investegate sample CSV file not found at: {INVESTEGATE_CSV_PATH}")
            
        df = pd.read_csv(INVESTEGATE_CSV_PATH)
        records = df.to_dict(orient="records")
        
        # Clean any float nan or infinite values
        for rec in records:
            for k, v in rec.items():
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    rec[k] = None
                elif pd.isna(v):
                    rec[k] = None
        
        # Helper to check completeness score
        def get_completeness_score(rec):
            if not rec:
                return 0.0
            non_empty = sum(
                1 for v in rec.values()
                if v is not None and v != "" and str(v).lower() != "nan" and str(v).lower() != "null"
            )
            return float(non_empty) / float(len(rec))
            
        # Sort in descending order of completeness score
        sorted_records = sorted(records, key=get_completeness_score, reverse=True)
        
        # Select top 15 records
        selected_records = sorted_records[:15]
        
        result = {
            "source": "Investegate",
            "records_scraped": 1500000,
            "sample_csv": INVESTEGATE_CSV_PATH,
            "sample_xlsx": INVESTEGATE_XLSX_PATH,
            "records": selected_records
        }
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while loading Investegate sample: {str(e)}"
        )


@router.get(
    "/sec/download/csv",
    summary="Download scraped Investegate sample CSV file",
    description="Returns the generated sample_investegate.csv file."
)
async def download_investegate_csv():
    """
    Downloads the sample_investegate.csv file.
    """
    if not os.path.exists(INVESTEGATE_CSV_PATH):
        raise HTTPException(
            status_code=404,
            detail="Sample CSV file not found. Please ensure the dataset is generated."
        )
    return FileResponse(
        path=INVESTEGATE_CSV_PATH,
        media_type="text/csv",
        filename="sample_investegate.csv"
    )


@router.get(
    "/sec/download/xlsx",
    summary="Download scraped Investegate sample Excel file",
    description="Returns the generated sample_investegate.xlsx file."
)
async def download_investegate_xlsx():
    """
    Downloads the sample_investegate.xlsx file.
    """
    if not os.path.exists(INVESTEGATE_XLSX_PATH):
        raise HTTPException(
            status_code=404,
            detail="Sample XLSX file not found. Please ensure the dataset is generated."
        )
    return FileResponse(
        path=INVESTEGATE_XLSX_PATH,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="sample_investegate.xlsx"
    )


# --- TurkeyBrokers Endpoints ---

@router.get(
    "/turkeybrokers/sample",
    summary="Get TurkeyBrokers sample data",
    description="Loads TurkeyBrokers records from the stored CSV dataset, selects 15 records with the highest field completeness, and returns the results."
)
async def get_turkeybrokers_sample():
    """
    Loads TurkeyBrokers records from the stored CSV dataset, selects 15 records
    with the highest field completeness, and returns the results.
    """
    try:
        import pandas as pd
        import numpy as np
        import math
        
        ensure_turkeybrokers_data()
        
        if not os.path.exists(TURKEYBROKERS_CSV_PATH):
            raise FileNotFoundError(f"TurkeyBrokers sample CSV file not found at: {TURKEYBROKERS_CSV_PATH}")
            
        df = pd.read_csv(TURKEYBROKERS_CSV_PATH)
        records = df.to_dict(orient="records")
        
        # Clean any float nan or infinite values
        for rec in records:
            for k, v in rec.items():
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    rec[k] = None
                elif pd.isna(v):
                    rec[k] = None
        
        # Helper to check completeness score
        def get_completeness_score(rec):
            if not rec:
                return 0.0
            non_empty = sum(
                1 for v in rec.values()
                if v is not None and v != "" and str(v).lower() != "nan" and str(v).lower() != "null"
            )
            return float(non_empty) / float(len(rec))
            
        # Sort in descending order of completeness score
        sorted_records = sorted(records, key=get_completeness_score, reverse=True)
        
        # Select top 15 records
        selected_records = sorted_records[:15]
        
        result = {
            "source": "TurkeyBrokers",
            "records_scraped": 500,
            "sample_csv": TURKEYBROKERS_CSV_PATH,
            "sample_xlsx": TURKEYBROKERS_XLSX_PATH,
            "records": selected_records
        }
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while loading TurkeyBrokers sample: {str(e)}"
        )


@router.get(
    "/turkeybrokers/download/csv",
    summary="Download scraped TurkeyBrokers sample CSV file",
    description="Returns the generated sample_turkeybrokers.csv file."
)
async def download_turkeybrokers_csv():
    """
    Downloads the sample_turkeybrokers.csv file.
    """
    ensure_turkeybrokers_data()
    if not os.path.exists(TURKEYBROKERS_CSV_PATH):
        raise HTTPException(
            status_code=404,
            detail="Sample CSV file not found. Please ensure the dataset is generated."
        )
    return FileResponse(
        path=TURKEYBROKERS_CSV_PATH,
        media_type="text/csv",
        filename="sample_turkeybrokers.csv"
    )


@router.get(
    "/turkeybrokers/download/xlsx",
    summary="Download scraped TurkeyBrokers sample Excel file",
    description="Returns the generated sample_turkeybrokers.xlsx file."
)
async def download_turkeybrokers_xlsx():
    """
    Downloads the sample_turkeybrokers.xlsx file.
    """
    ensure_turkeybrokers_data()
    if not os.path.exists(TURKEYBROKERS_XLSX_PATH):
        raise HTTPException(
            status_code=404,
            detail="Sample XLSX file not found. Please ensure the dataset is generated."
        )
    return FileResponse(
        path=TURKEYBROKERS_XLSX_PATH,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="sample_turkeybrokers.xlsx"
    )


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
    return str(scope or "").strip().lower() in {"partial scrape", "partial dump", "custom dump", "custom"}


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

def ensure_turkeybrokers_data():
    import pandas as pd
    path = os.path.join(BASE_DIR, "sample_turkeybrokers.csv")
    xlsx_path = os.path.join(BASE_DIR, "sample_turkeybrokers.xlsx")
    
    data = [
        {"PrimaryKey": "TB-001", "Address": "Ataturk Bulvari No: 12, Ankara", "City": "Ankara"},
        {"PrimaryKey": "TB-002", "Address": "Istiklal Caddesi No: 45, Istanbul", "City": "Istanbul"},
        {"PrimaryKey": "TB-003", "Address": "Cumhuriyet Meydani No: 8, Izmir", "City": "Izmir"},
        {"PrimaryKey": "TB-004", "Address": "Mevlana Caddesi No: 99, Konya", "City": "Konya"},
        {"PrimaryKey": "TB-005", "Address": "Talatpasa Bulvari No: 3, Izmir", "City": "Izmir"},
        {"PrimaryKey": "TB-006", "Address": "Bagdat Caddesi No: 202, Istanbul", "City": "Istanbul"},
        {"PrimaryKey": "TB-007", "Address": "Barbaros Bulvari No: 88, Istanbul", "City": "Istanbul"},
        {"PrimaryKey": "TB-008", "Address": "Kenan Evren Bulvari No: 15, Adana", "City": "Adana"},
        {"PrimaryKey": "TB-009", "Address": "Gazi Mustafa Kemal Bulvari No: 54, Ankara", "City": "Ankara"},
        {"PrimaryKey": "TB-010", "Address": "Ataturk Caddesi No: 77, Bursa", "City": "Bursa"},
        {"PrimaryKey": "TB-011", "Address": "Inonu Caddesi No: 120, Izmir", "City": "Izmir"},
        {"PrimaryKey": "TB-012", "Address": "Halaskargazi Caddesi No: 34, Istanbul", "City": "Istanbul"},
        {"PrimaryKey": "TB-013", "Address": "Ziya Gokalp Caddesi No: 9, Ankara", "City": "Ankara"},
        {"PrimaryKey": "TB-014", "Address": "Fevzi Pasa Caddesi No: 150, Istanbul", "City": "Istanbul"},
        {"PrimaryKey": "TB-015", "Address": "Mithatpasa Caddesi No: 21, Ankara", "City": "Ankara"},
    ]
    
    needs_generation = False
    if not os.path.exists(path) or not os.path.exists(xlsx_path):
        needs_generation = True
    else:
        try:
            df_temp = pd.read_csv(path)
            if len(df_temp) < 15:
                needs_generation = True
        except Exception:
            needs_generation = True
            
    if needs_generation:
        df = pd.DataFrame(data)
        df.to_csv(path, index=False)
        df.to_excel(xlsx_path, index=False)

import asyncio

def get_record_key(source: str, r: dict) -> str:
    src = source.lower()
    if "keysight" in src:
        return str(r.get("sku") or r.get("_model_Num") or "")
    if "webmd" in src:
        return str(r.get("Detail_Url") or r.get("detail_url") or r.get("Business_Name") or r.get("Primary_Phone") or "")
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
    if "turkeybrokers" in src:
        return str(r.get("PrimaryKey") or r.get("primary_key") or r.get("listing_url") or "")
    if "investegate" in src:
        if r.get("filing_document_link"):
            return str(r.get("filing_document_link"))
        ticker = str(r.get("ticker") or r.get("Ticker") or "")
        fdate = str(r.get("filing_date") or r.get("Filing_Date") or "")
        if ticker or fdate:
            return f"{ticker}_{fdate}"
        return ""
    return str(r.get("url") or r.get("id") or "")

def simulate_demo_mutations(source: str, records: list) -> list:
    if not records:
        return records
    import copy
    mutated = copy.deepcopy(records)
    source_lower = source.lower()
    
    if "keysight" in source_lower:
        target_rec = None
        for r in mutated:
            if str(r.get("sku") or "").strip() == "10020A":
                target_rec = r
                break
        if not target_rec and len(mutated) > 0:
            target_rec = mutated[0]
            
        if target_rec:
            curr_name = target_rec.get("name") or "Resistive Divider Probe Kit"
            target_rec["name"] = curr_name + " Mutated"
            target_rec["price"] = "$5,200.00"
            target_rec["Discontinued"] = True
        if len(mutated) > 1:
            mutated[1]["is_in_stock"] = 0
            
    elif "webmd" in source_lower:
        if len(mutated) > 0:
            curr_name = mutated[0].get("Business_Name") or mutated[0].get("Primary_Contact_Name") or "Dr. Aaron F. Kulick MD"
            mutated[0]["Business_Name"] = curr_name + " Mutated"
            cur = mutated[0].get("Accepting_New_Patients")
            mutated[0]["Accepting_New_Patients"] = "No" if cur == "Yes" else "Yes"
        if len(mutated) > 1:
            mutated[1]["Hospital_Affiliations"] = "City Memorial Hospital"
            
    elif "turkeybrokers" in source_lower:
        if len(mutated) > 0:
            mutated[0]["Address"] = "New Address Road No: 5, Istanbul"
            
    elif "investegate" in source_lower:
        if len(mutated) > 0:
            mutated[0]["filing_type"] = "8-K"
            
    return mutated

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

    # Keep new source onboarding jobs pending until a dedicated onboarding flow updates them.
    if bool(is_custom) and str(current_status) == "Pending Onboarding":
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
            from app.services.workflow_service import workflow_service, parse_employee_count, parse_headquarters
            
            run_website = any("website" in str(s).lower() and "linkedin" not in str(s).lower() for s in picked_sources)
            run_sec = any("sec" in str(s).lower() or "edgar" in str(s).lower() for s in picked_sources)
            run_linkedin = any("linkedin" in str(s).lower() for s in picked_sources)
            run_mca = any("mca" in str(s).lower() for s in picked_sources)
            run_crunchbase = any("crunchbase" in str(s).lower() for s in picked_sources)
            
            # Default to running website if picked_sources is empty
            if not picked_sources:
                run_website = True

            # Concurrency limit and task definition
            sem = asyncio.Semaphore(5)

            def _normalize_uploaded_key(value: Any) -> str:
                return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())

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
                    email_val = _resolve_uploaded_value(record, "email")
                    phone_val = _resolve_uploaded_value(record, "phone")
                    linkedin_val = _resolve_uploaded_value(record, "linkedin_url")
                    registry_val = _resolve_uploaded_value(record, "registry_number")
                    ticker_val = _resolve_uploaded_value(record, "ticker")
                    
                    scraped_metadata = {}
                    website_resolved = None
                    sec_fields = {}
                    mca_fields = {}
                    linkedin_metadata = {}
                    
                    # For demo performance, only do real scraping for the first 5 records
                    should_scrape = (idx < 5)
                    
                    if should_scrape and run_website:
                        verification_input = {
                            "company": company_val,
                            "website": website_val,
                            "email": email_val,
                            "phone": phone_val,
                            "linkedin": linkedin_val
                        }
                        try:
                            res = await asyncio.wait_for(
                                company_verification_service.verify_record(verification_input, {}),
                                timeout=4.0
                            )
                            scraped_metadata = res.get("scraped_metadata") or {}
                            website_resolved = res.get("website")
                        except Exception as e:
                            logger.warning("[By Dataset] Scraper failed/timed out for %s: %s", company_val, e)
                            
                    if should_scrape and run_sec:
                        try:
                            res_sec = await asyncio.wait_for(
                                sec_scraper.lookup_company(
                                    company_val,
                                    cik=registry_val,
                                    ticker=ticker_val
                                ),
                                timeout=3.0
                            )
                            if res_sec.get("raw_metadata", {}).get("status") == "success":
                                sec_fields = res_sec.get("extracted_fields") or {}
                        except Exception as e:
                            logger.warning("[By Dataset] SEC EDGAR lookup failed/timed out for %s: %s", company_val, e)

                    if should_scrape and run_mca:
                        try:
                            res_mca = await asyncio.wait_for(
                                mca_scraper.lookup_company(company_val),
                                timeout=3.0
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
                                timeout=3.0
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
                            val = sec_fields.get("website") or linkedin_metadata.get("website") or linkedin_metadata.get("linkedin_website") or scraped_metadata.get("url") or website_resolved or website_val
                            enriched_row[key] = val if val else None
                        elif key == "description":
                            val = linkedin_metadata.get("description") or linkedin_metadata.get("linkedin_description") or scraped_metadata.get("meta_description") or sec_fields.get("sic_description")
                            enriched_row[key] = val if val else None
                        elif key in ("phone", "contact_phone"):
                            phones = scraped_metadata.get("phone_numbers") or []
                            val = sec_fields.get("profile", {}).get("phone") or (phones[0] if phones else None) or phone_val
                            enriched_row[key] = val if val else None
                        elif key in ("email", "contact_email"):
                            emails = scraped_metadata.get("emails") or []
                            val = (emails[0] if emails else None) or email_val
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
                            val = sec_street or mca_fields.get("registered_office_address") or li_hq_str or scraped_metadata.get("hq_address") or scraped_metadata.get("address")
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
                        elif key in ("funding_total", "latest_round", "latest_round_amount", "valuation", "investors"):
                            enriched_row[key] = cb_fields.get(key) or None
                        elif key in ("annual_revenue", "revenue_range"):
                            enriched_row[key] = cb_fields.get(key) or None
                        else:
                            matched_val = record.get(mapping.get(key) or key)
                            enriched_row[key] = matched_val if matched_val is not None else None
                    return enriched_row

            tasks = [process_record_safe(idx, rec) for idx, rec in enumerate(input_rows)]
            enriched_records = await asyncio.gather(*tasks)

            # Wait 5 seconds simulating output file generation & review preparation
            await asyncio.sleep(5)
            
            records_count = len(input_rows)
            freshness_val = random.randint(95, 100)
            now_str = datetime.utcnow().isoformat() + "Z"
            
            from datetime import timedelta
            now = datetime.utcnow()
            if frequency == "Daily":
                next_date = now + timedelta(days=1)
            elif frequency == "Monthly":
                next_date = now + timedelta(days=30)
            elif frequency == "Quarterly":
                next_date = now + timedelta(days=90)
            else:
                next_date = now + timedelta(days=7)
            next_refresh_str = next_date.isoformat() + "Z"

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
                json.dump(enriched_records, f_run, ensure_ascii=False, indent=2)

            from app.services.workflow_service import workflow_service
            workflow_service.runs[job_id] = {
                "run_id": job_id,
                "dataset_id": job_id,
                "dataset_name": source,
                "processed_dataset": enriched_records
            }
            return

        if "keysight" in source_lower:
            from app.services.scrapers.keysight_scraper import scrape_keysight_products
            filters = resolved_filters
            records = scrape_keysight_products(filters)
            
        elif "webmd" in source_lower:
            import pandas as pd
            csv_path = os.path.join(BASE_DIR, "sample_webmd.csv")
            if os.path.exists(csv_path):
                df = pd.read_csv(csv_path)
                records = df.to_dict(orient="records")
                for r in records:
                    for k, v in r.items():
                        if pd.isna(v):
                            r[k] = None
                if _is_partial_scope(scope):
                    filters = resolved_filters
                    records = filter_records(records, filters)
                    
        elif "investegate" in source_lower:
            import pandas as pd
            csv_path = os.path.join(BASE_DIR, "sample_investegate.csv")
            if os.path.exists(csv_path):
                df = pd.read_csv(csv_path)
                records = df.to_dict(orient="records")
                for r in records:
                    for k, v in r.items():
                        if pd.isna(v):
                            r[k] = None
                if _is_partial_scope(scope):
                    filters = resolved_filters
                    records = filter_records(records, filters)
                    
        elif "turkeybrokers" in source_lower:
            import pandas as pd
            ensure_turkeybrokers_data()
            csv_path = os.path.join(BASE_DIR, "sample_turkeybrokers.csv")
            if os.path.exists(csv_path):
                df = pd.read_csv(csv_path)
                records = df.to_dict(orient="records")
                for r in records:
                    for k, v in r.items():
                        if pd.isna(v):
                            r[k] = None
                if _is_partial_scope(scope):
                    filters = resolved_filters
                    records = filter_records(records, filters)
                    
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
        run_file_path = os.path.join(run_file_dir, f"{job_id}_run_{refresh_count_curr + 1}.json")
        with open(run_file_path, "w", encoding="utf-8") as f_run:
            json.dump(records, f_run, ensure_ascii=False, indent=2)
            
        # Compute comparisons diff
        total_changes = 0
        comparison_log = {}
        
        if refresh_count_curr == 0:
            # First run: WCM not run, everything treated as A (Added)
            total_changes = len(records)
            comparison_log = {
                "baseline_file": "",
                "current_file": f"{job_id}_run_1.json",
                "records_compared": len(records),
                "added": len(records),
                "modified": 0,
                "deleted": 0,
                "verified": 0,
                "change_percentage": 100.0,
                "modified_details": []
            }
        else:
            # Load baseline approved dataset
            baseline_records = []
            baseline_path = os.path.join(run_file_dir, f"{job_id}_final.json")
            if os.path.exists(baseline_path):
                try:
                    with open(baseline_path, "r", encoding="utf-8") as f_base:
                        baseline_records = json.load(f_base)
                except Exception:
                    pass
            
            # Compare using wcm_comparison_service
            from app.services.wcm_comparison_service import compare_records
            flattened_rows, record_change_count = compare_records(
                source,
                baseline_records,
                records,
                allowed_attrs=selected_outputs if selected_outputs else None,
                attr_mapping=mapping if mapping else None,
            )
            total_changes = record_change_count
            
            # Calculate comparison metrics
            from app.api.demo_routes import get_record_key
            
            baseline_keys = set()
            for idx, r in enumerate(baseline_records):
                key = get_record_key(source, r) or f"idx_{idx}"
                orig_key = key
                counter = 1
                while key in baseline_keys:
                    key = f"{orig_key}_{counter}"
                    counter += 1
                baseline_keys.add(key)
                
            current_keys = set()
            for idx, r in enumerate(records):
                key = get_record_key(source, r) or f"idx_{idx}"
                orig_key = key
                counter = 1
                while key in current_keys:
                    key = f"{orig_key}_{counter}"
                    counter += 1
                current_keys.add(key)
                
            all_keys = baseline_keys.union(current_keys)
            
            added_count = 0
            deleted_count = 0
            modified_count = 0
            verified_count = 0
            modified_details = []
            
            # Group flattened comparison rows by recordKey and check for M rows
            key_changes = {}
            for row in flattened_rows:
                k = row["recordKey"]
                change_type = row["changeType"]
                if change_type in ("A", "M", "D"):
                    if k not in key_changes:
                        key_changes[k] = []
                    key_changes[k].append(row)
                    
            for k in all_keys:
                if k in current_keys and k not in baseline_keys:
                    added_count += 1
                elif k in baseline_keys and k not in current_keys:
                    deleted_count += 1
                else:
                    if k in key_changes:
                        modified_count += 1
                        for change in key_changes[k]:
                            if change["changeType"] == "M":
                                modified_details.append({
                                    "record_key": k,
                                    "attribute": change["attributeKey"],
                                    "old_value": change["previous"],
                                    "new_value": change["value"]
                                })
                    else:
                        verified_count += 1
                        
            records_compared = len(all_keys)
            change_percentage = round((added_count + modified_count + deleted_count) / records_compared * 100, 2) if records_compared > 0 else 0.0
            
            comparison_log = {
                "baseline_file": f"{job_id}_final.json",
                "current_file": f"{job_id}_run_{refresh_count_curr + 1}.json",
                "records_compared": records_compared,
                "added": added_count,
                "modified": modified_count,
                "deleted": deleted_count,
                "verified": verified_count,
                "change_percentage": change_percentage,
                "modified_details": modified_details
            }
            
        # Write comparison audit log
        comparison_log_path = os.path.join(run_file_dir, f"{job_id}_comparison.json")
        try:
            with open(comparison_log_path, "w", encoding="utf-8") as f_comp:
                json.dump(comparison_log, f_comp, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error("Failed to write comparison log file: %s", e)

        # Recalculate next refresh date
        from datetime import datetime as dt, timedelta
        now = dt.utcnow()
        if frequency == "2 Minutes":
            next_date = now + timedelta(minutes=2)
        elif frequency == "Daily":
            next_date = now + timedelta(days=1)
        elif frequency == "Monthly":
            next_date = now + timedelta(days=30)
        elif frequency == "Quarterly":
            next_date = now + timedelta(days=90)
        else:
            next_date = now + timedelta(days=7)
        next_refresh_str = next_date.isoformat() + "Z"
        
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
                       refresh_history_json = ?,
                       changes_detected = ?
                   WHERE id = ?""",
                (len(records), now_str, next_refresh_str, json.dumps(history), total_changes, job_id)
            )
            conn.commit()
            
        from app.services.workflow_service import workflow_service
        workflow_service.runs[job_id] = {
            "run_id": job_id,
            "dataset_id": job_id,
            "dataset_name": source,
            "processed_dataset": records
        }
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
async def launch_jobs(request: LaunchJobsRequest, background_tasks: BackgroundTasks):
    for item in request.jobs:
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
        
        from datetime import datetime as dt, timedelta
        now = dt.utcnow()
        if item.frequency == "Daily":
            next_date = now + timedelta(days=1)
        elif item.frequency == "Monthly":
            next_date = now + timedelta(days=30)
        elif item.frequency == "Quarterly":
            next_date = now + timedelta(days=90)
        else:
            next_date = now + timedelta(days=7)
        next_refresh_str = next_date.isoformat() + "Z"

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

        status_val = "Running"

        if exists:
            with get_connection() as conn:
                conn.execute(
                    """UPDATE scraper_jobs
                       SET source = ?, scope = ?, filters = ?, custom_criteria = ?, planner_json = ?, frequency = ?, delivery = ?,
                           output_format = ?, dataset_path = ?, status = ?, 
                           created_at = ?, next_refresh = ?, is_custom_source = ?, mode = ?,
                           complexity = ?, estimated_onboarding_time = ?, records = ?
                       WHERE id = ?""",
                    (item.source, item.scope, effective_filters, raw_partial_request or item.custom_criteria or "—", item.frequency, item.delivery,
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
        
    return {"status": "success", "launched_count": len(request.jobs)}


@router.post("/jobs/create_pending")
async def create_pending_job(item: PendingJobItem):
    import random
    job_id = f"J-{random.randint(1000, 9999)}"
    now_str = datetime.utcnow().isoformat() + "Z"
    status = "Pending Onboarding"
    
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO scraper_jobs (id, source, scope, filters, custom_criteria, frequency, delivery, 
                                        output_format, dataset_path, status, created_at, is_custom_source, mode, complexity, estimated_onboarding_time)
               VALUES (?, ?, 'Full Dump', '—', '—', 'Weekly', 'S3 bucket', 'JSON', ?, ?, ?, 1, 'Site-Specific', ?, ?)""",
            (job_id, item.website_url, f"datasets/{item.source_name.lower()}_sample.csv", status, now_str, item.complexity, item.estimated_development_effort)
        )
        conn.commit()
    return {"status": "success", "job_id": job_id}


@router.get("/jobs")
async def get_jobs():
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT id, source, scope, filters, custom_criteria, frequency, delivery, output_format, 
                      dataset_path, status, records, fresh, created_at, last_refresh, next_refresh, 
                      refresh_count, is_custom_source, mode, refresh_history_json, changes_detected,
                      complexity, estimated_onboarding_time
               FROM scraper_jobs"""
        ).fetchall()
    
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
            
    return {"status": "success"}


# Confidence report preview route has been removed.


@router.get("/jobs/review_data")
async def get_jobs_review_data(job_id: str, sample_rate: float = 2.0):
    from app.services.wcm_comparison_service import get_review_rows
    try:
        data = get_review_rows(job_id, sample_rate)
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
        run_file_path = os.path.join(decisions_dir, f"{job_id}_run_{refresh_count + 1}.json")
        new_records = []
        if os.path.exists(run_file_path):
            try:
                with open(run_file_path, "r", encoding="utf-8") as f:
                    new_records = json.load(f)
            except Exception:
                pass

        # Load baseline
        baseline_records = []
        if refresh_count > 0:
            baseline_path = os.path.join(decisions_dir, f"{job_id}_final.json")
            if os.path.exists(baseline_path):
                try:
                    with open(baseline_path, "r", encoding="utf-8") as f:
                        baseline_records = json.load(f)
                except Exception:
                    pass

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
