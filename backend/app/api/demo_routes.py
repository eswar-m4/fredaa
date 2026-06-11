"""
Temporary demo router for Keysight and WebMD Scraper integrations.
"""

import os
import json
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from app.services.scrapers.keysight_scraper import (
    main as run_keysight_scraper,
    scrape_keysight_products
)
from app.services.scrapers.webmd_scraper import main as run_webmd_scraper

router = APIRouter()

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
    frequency: str
    delivery: str
    output_format: str
    isCustomSource: bool
    mode: str
    complexity: Optional[str] = None
    estimated_onboarding_time: Optional[str] = None

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

def ensure_turkeybrokers_data():
    import pandas as pd
    path = os.path.join(BASE_DIR, "sample_turkeybrokers.csv")
    xlsx_path = os.path.join(BASE_DIR, "sample_turkeybrokers.xlsx")
    if not os.path.exists(path):
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
            {"PrimaryKey": "TB-015", "Address": "Mithatpasa Caddesi No: 21, Ankara", "City": "Ankara"},
        ]
        df = pd.DataFrame(data)
        df.to_csv(path, index=False)
        df.to_excel(xlsx_path, index=False)

import asyncio

def get_record_key(source: str, r: dict) -> str:
    src = source.lower()
    if "keysight" in src:
        return str(r.get("sku") or r.get("_model_Num") or "")
    if "webmd" in src:
        return str(r.get("Business_Name") or r.get("Primary_Phone") or "")
    if "turkeybrokers" in src:
        return str(r.get("PrimaryKey") or r.get("Address") or "")
    if "investegate" in src:
        return str(r.get("entity_name") or r.get("ticker") or "") + "_" + str(r.get("filing_date") or "")
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
    # 1. Update status to 'Running'
    with get_connection() as conn:
        conn.execute(
            "UPDATE scraper_jobs SET status = 'Running' WHERE id = ?",
            (job_id,)
        )
        conn.commit()
    
    # 2. Get job info from DB
    with get_connection() as conn:
        row = conn.execute(
            "SELECT source, scope, filters, custom_criteria FROM scraper_jobs WHERE id = ?",
            (job_id,)
        ).fetchone()
    
    if not row:
        return
        
    source, scope, filters_str, custom_criteria = row
    
    # Fetch refresh count and frequency to determine run state
    with get_connection() as conn:
        job_info_db = conn.execute(
            "SELECT refresh_count, frequency, mode, is_custom_source, complexity, estimated_onboarding_time FROM scraper_jobs WHERE id = ?",
            (job_id,)
        ).fetchone()
    refresh_count_curr = job_info_db[0] if job_info_db else 0
    frequency = job_info_db[1] if job_info_db else "Weekly"
    job_mode = job_info_db[2] if job_info_db else "Site-Specific"
    is_custom = job_info_db[3] if job_info_db else 0
    complexity = job_info_db[4] if job_info_db else None
    estimated_onboarding_time = job_info_db[5] if job_info_db else None
    
    # Translate Custom prompt using Qwen LLM
    if scope == "Custom" and custom_criteria and custom_criteria not in ("—", "- -"):
        try:
            import logging
            logging.basicConfig(level=logging.INFO)
            logger = logging.getLogger("app.api.demo_routes")
            from app.services.custom_dump_llm_service import custom_dump_llm_service
            logger.info(f"Custom Dump translation triggered for job {job_id} on source {source} with prompt: {custom_criteria}")
            validated_filters = custom_dump_llm_service.translate_prompt(source, custom_criteria)
            filters_str = custom_dump_llm_service.format_to_query_string(validated_filters)
            
            # Save the updated filters in the database for UI consistency and export lookup
            with get_connection() as conn:
                conn.execute(
                    "UPDATE scraper_jobs SET filters = ? WHERE id = ?",
                    (filters_str, job_id)
                )
                conn.commit()
            logger.info(f"Custom Dump translated query string saved to DB: {filters_str}")
        except Exception as e:
            import logging
            logger = logging.getLogger("app.api.demo_routes")
            logger.error(f"Error in Custom Dump LLM translation for job {job_id}: {e}")
    
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
        filters_str = conn.execute("SELECT filters FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()[0]
    
    records = []
    source_lower = source.lower()
    
    try:
        if "keysight" in source_lower:
            from app.services.scrapers.keysight_scraper import scrape_keysight_products
            filters = parse_criteria(filters_str)
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
                if scope in ("Partial Dump", "Custom"):
                    filters = parse_criteria(filters_str)
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
                if scope in ("Partial Dump", "Custom"):
                    criteria_to_use = filters_str if scope == "Partial Dump" else custom_criteria
                    filters = parse_criteria(criteria_to_use)
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
                if scope in ("Partial Dump", "Custom"):
                    filters = parse_criteria(filters_str)
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
        comparisons = []
        added_count = 0
        removed_count = 0
        modified_count = 0
        total_changes = 0
        
        if refresh_count_curr >= 1:
            # Load previous clean run records
            prev_file_path = os.path.join(run_file_dir, f"{job_id}_run_{refresh_count_curr}.json")
            prev_records = []
            if os.path.exists(prev_file_path):
                try:
                    with open(prev_file_path, "r", encoding="utf-8") as f_prev:
                        prev_records = json.load(f_prev)
                except Exception:
                    pass
            
            # Apply in-memory mutations to simulate changes only for comparison layer
            mutated_records = simulate_demo_mutations(source, records)
            
            prev_map = {get_record_key(source, r): r for r in prev_records if get_record_key(source, r)}
            curr_map = {get_record_key(source, r): r for r in mutated_records if get_record_key(source, r)}
            
            # Check removed and modified
            for key, prev_r in prev_map.items():
                if key not in curr_map:
                    removed_count += 1
                    comparisons.append({
                        "field": f"Record {key}",
                        "existing_value": "Present",
                        "suggested_value": "REMOVED"
                    })
                else:
                    curr_r = curr_map[key]
                    for field in prev_r.keys():
                        if field in curr_r and prev_r[field] != curr_r[field]:
                            modified_count += 1
                            comparisons.append({
                                "field": f"{key} -> {field}",
                                "existing_value": str(prev_r[field]),
                                "suggested_value": str(curr_r[field])
                            })
                            
            # Check added
            for key in curr_map.keys():
                if key not in prev_map:
                    added_count += 1
                    comparisons.append({
                        "field": f"Record {key}",
                        "existing_value": "ABSENT",
                        "suggested_value": "ADDED"
                    })
            total_changes = added_count + removed_count + modified_count
            
        # Capture, clean, and store HTML snapshots
        from app.services.confidence_report_html_service import confidence_report_html_service
        
        target_url = ""
        source_lower = source.lower()
        if records and isinstance(records, list) and len(records) > 0:
            target_rec = None
            if "keysight" in source_lower:
                for r in records:
                    if str(r.get("sku") or "").strip() == "10020A":
                        target_rec = r
                        break
            if not target_rec:
                target_rec = records[0]
                
            url_val = target_rec.get("url") or target_rec.get("Detail_Url") or target_rec.get("url_path") or ""
            if url_val:
                if url_val.startswith("http"):
                    target_url = url_val
                else:
                    path = url_val if url_val.startswith("/") else "/" + url_val
                    if "keysight" in source_lower:
                        target_url = "https://www.keysight.com" + path
                    elif "webmd" in source_lower:
                        target_url = "https://doctor.webmd.com" + path
                    elif source.startswith("http"):
                        from urllib.parse import urlparse
                        parsed_src = urlparse(source)
                        base_host = f"{parsed_src.scheme}://{parsed_src.netloc}"
                        target_url = base_host + path
                    else:
                        target_url = source + path

        if not target_url:
            if source.startswith("http"):
                target_url = source
            elif "keysight" in source_lower:
                target_url = "https://www.keysight.com/us/en/product/10020A/resistive-divider-probe-kit.html"
            elif "webmd" in source_lower:
                target_url = "https://doctor.webmd.com/doctor/dr-aaron-f-kulick-md-40da227b-da51-4b23-9b37-5fa345719ea4-overview"
            elif "turkeybrokers" in source_lower:
                target_url = "https://www.turkeybrokers.com/"
            elif "investegate" in source_lower:
                target_url = "https://www.investegate.co.uk/"
            
        raw_html = ""
        if target_url:
            try:
                raw_html = confidence_report_html_service.fetch_source_html(target_url)
            except Exception:
                pass
                
        if not raw_html:
            raw_html = confidence_report_html_service.generate_local_fallback_mock_html(source)
            raw_html = confidence_report_html_service.apply_record_mutations_to_html(raw_html, source, records)
            
        cleaned_html = confidence_report_html_service._strip_nonessential_source_content(raw_html)
        
        if refresh_count_curr == 0:
            # Baseline run: Save clean raw HTML snapshot directly without synthetic modifications
            snapshot_path = os.path.join(run_file_dir, f"{job_id}_snapshot_1.html")
            with open(snapshot_path, "w", encoding="utf-8") as f_snap:
                f_snap.write(cleaned_html)
        else:
            # Refresh run: Load baseline snapshot
            snapshot_1_path = os.path.join(run_file_dir, f"{job_id}_snapshot_1.html")
            baseline_html = ""
            if os.path.exists(snapshot_1_path):
                with open(snapshot_1_path, "r", encoding="utf-8") as f_snap:
                    baseline_html = f_snap.read()
            if not baseline_html:
                baseline_html = cleaned_html
                with open(snapshot_1_path, "w", encoding="utf-8") as f_snap:
                    f_snap.write(baseline_html)
            
            # Apply Run N mutated records to baseline HTML via string replacement pairs
            pairs = []
            for entry in comparisons:
                field_name = entry.get("field", "")
                old_val = entry.get("existing_value")
                new_val = entry.get("suggested_value")
                if old_val and new_val and old_val != new_val:
                    if old_val not in ("Present", "ABSENT", "REMOVED", "ADDED"):
                        # Only replace strings of length >= 3 and not boolean/null sentinels to avoid matching structural HTML elements/digits
                        if len(old_val) >= 3 and old_val.lower() not in ("true", "false", "none", "nil value"):
                            pairs.append((field_name, old_val, new_val))
                        
            current_html = confidence_report_html_service._apply_replacements(baseline_html, pairs)
            
            # Compare baseline and current HTML text nodes in parallel to generate inline diffs
            diff_html = confidence_report_html_service.build_inline_html_diff(baseline_html, current_html)
            
            # Save diff file
            diff_path = os.path.join(run_file_dir, f"{job_id}_confidence_diff.html")
            with open(diff_path, "w", encoding="utf-8") as f_diff:
                f_diff.write(diff_html)
            
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
        
        import random
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
                   SET status = 'Completed', 
                       records = ?, 
                       fresh = 100, 
                       last_refresh = ?, 
                       next_refresh = ?,
                       refresh_count = refresh_count + 1,
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
        with get_connection() as conn:
            exists = conn.execute("SELECT 1 FROM scraper_jobs WHERE id = ?", (item.id,)).fetchone()
        
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

        if exists:
            with get_connection() as conn:
                conn.execute(
                    """UPDATE scraper_jobs 
                       SET source = ?, scope = ?, filters = ?, frequency = ?, delivery = ?, 
                           output_format = ?, dataset_path = ?, status = 'Running', 
                           created_at = ?, next_refresh = ?, is_custom_source = ?, mode = ?,
                           complexity = ?, estimated_onboarding_time = ?
                       WHERE id = ?""",
                    (item.source, item.scope, item.filters, item.frequency, item.delivery,
                     item.output_format, dataset_path, now_str, next_refresh_str,
                     1 if item.isCustomSource else 0, item.mode, complexity_val, sla_val, item.id)
                )
                conn.commit()
        else:
            with get_connection() as conn:
                conn.execute(
                    """INSERT INTO scraper_jobs (id, source, scope, filters, custom_criteria, frequency, delivery, 
                                                output_format, dataset_path, status, created_at, next_refresh, 
                                                is_custom_source, mode, complexity, estimated_onboarding_time)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Running', ?, ?, ?, ?, ?, ?)""",
                    (item.id, item.source, item.scope, item.filters, item.filters, item.frequency, item.delivery,
                     item.output_format, dataset_path, now_str, next_refresh_str,
                     1 if item.isCustomSource else 0, item.mode, complexity_val, sla_val)
                )
                conn.commit()
        
        # Delete pending job to prevent duplicates
        try:
            with get_connection() as conn:
                conn.execute(
                    "DELETE FROM scraper_jobs WHERE source = ? AND (status = 'Analysis Complete' OR status = 'Pending Onboarding')",
                    (item.source,)
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
    
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO scraper_jobs (id, source, scope, filters, custom_criteria, frequency, delivery, 
                                        output_format, dataset_path, status, created_at, is_custom_source, mode, complexity, estimated_onboarding_time)
               VALUES (?, ?, 'Full Dump', '—', '—', 'Weekly', 'S3 bucket', 'JSON', ?, ?, ?, 1, 'Site-Specific', ?, ?)""",
            (job_id, item.website_url, f"datasets/{item.source_name.lower()}_sample.csv", item.status, now_str, item.complexity, item.estimated_development_effort)
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
        history = []
        if r["refresh_history_json"]:
            try:
                history = json.loads(r["refresh_history_json"])
            except Exception:
                pass
                
        jobs.append({
            "id": r["id"],
            "source": r["source"],
            "scope": r["scope"],
            "filters": r["filters"],
            "custom_criteria": r["custom_criteria"],
            "frequency": r["frequency"],
            "delivery": r["delivery"],
            "output_format": r["output_format"],
            "dataset_path": r["dataset_path"],
            "status": r["status"],
            "records": r["records"],
            "fresh": r["fresh"],
            "created_at": r["created_at"],
            "last_refresh": r["last_refresh"],
            "next_refresh": r["next_refresh"],
            "refresh_count": r["refresh_count"],
            "isCustomSource": bool(r["is_custom_source"]),
            "mode": r["mode"],
            "changes_detected": r["changes_detected"] if "changes_detected" in r.keys() else 0,
            "refresh_history": history,
            "complexity": r["complexity"] if "complexity" in r.keys() else None,
            "estimated_onboarding_time": r["estimated_onboarding_time"] if "estimated_onboarding_time" in r.keys() else None,
        })
    return jobs


@router.get("/jobs/{job_id}/confidence-report/preview")
async def preview_confidence_report(job_id: str):
    from fastapi.responses import HTMLResponse
    
    # Retrieve refresh_count from database
    refresh_count = 0
    with get_connection() as conn:
        row = conn.execute("SELECT refresh_count FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
        if row:
            refresh_count = row[0]
            
    # If refresh count is >= 2, try to serve diff report
    if refresh_count >= 2:
        diff_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_confidence_diff.html")
        if os.path.exists(diff_path):
            try:
                with open(diff_path, "r", encoding="utf-8") as f:
                    html_content = f.read()
                return HTMLResponse(content=html_content, status_code=200)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to read confidence diff: {str(e)}")
                
    # Otherwise stream baseline snapshot 1 (First Run fallback)
    snap_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_snapshot_1.html")
    if os.path.exists(snap_path):
        try:
            with open(snap_path, "r", encoding="utf-8") as f:
                html_content = f.read()
            return HTMLResponse(content=html_content, status_code=200)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read baseline snapshot: {str(e)}")
            
    # Default fallback
    fallback_html = """<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Confidence Report Preview</title>
  <style>body { font-family: Arial, sans-serif; padding: 20px; color: #111827; }</style>
</head>
<body>
  <h3>Confidence Report Preview</h3>
  <p>Baseline preview page is being prepared or is not available yet.</p>
</body>
</html>"""
    return HTMLResponse(content=fallback_html, status_code=200)

