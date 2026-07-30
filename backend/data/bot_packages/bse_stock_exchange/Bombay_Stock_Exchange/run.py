from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import requests


PACKAGE_ROOT = Path(__file__).resolve().parent
INPUT_FILE = PACKAGE_ROOT / "input_BSE.txt"

API_BASE = "https://api.bseindia.com/BseIndiaAPI/api"
PAGE_URL = "https://www.bseindia.com/corporates/HistoricalAnnualReport.aspx"
BASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": PAGE_URL,
}


def _normalize(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _is_numeric_code(value: Any) -> bool:
    return str(value or "").strip().isdigit()


def _load_seed_rows() -> List[Dict[str, str]]:
    if not INPUT_FILE.exists():
        raise FileNotFoundError(f"BSE input file not found: {INPUT_FILE}")

    with open(INPUT_FILE, "r", encoding="utf-8", errors="ignore", newline="") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))
    return [
        {
            "clientid": str(row.get("clientid") or "").strip(),
            "InputId": str(row.get("InputId") or "").strip(),
            "target_site_domain": str(row.get("target_site_domain") or "").strip(),
            "target_input_company_name": str(row.get("target_input_company_name") or "").strip(),
            "target_input_code": str(row.get("target_input_code") or "").strip(),
            "target_product_url": str(row.get("target_product_url") or "").strip(),
        }
        for row in rows
        if any(str(v or "").strip() for v in row.values())
    ]


def _session() -> requests.Session:
    sess = requests.Session()
    sess.headers.update(BASE_HEADERS)
    # Prime the session against the live page so the API call mirrors browser usage.
    sess.get(PAGE_URL, headers={"User-Agent": BASE_HEADERS["User-Agent"]}, timeout=30)
    return sess


def _search_candidates(sess: requests.Session, query: str) -> List[Dict[str, Any]]:
    query = str(query or "").strip()
    if not query:
        return []

    candidates: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str]] = set()

    for endpoint in ("ListScripSmartSearch_ng", "GetQuoteAllSearchDatabeta"):
        try:
            response = sess.get(
                f"{API_BASE}/{endpoint}/w",
                params={"searchString": query},
                timeout=30,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list):
                continue
            for row in payload:
                if not isinstance(row, dict):
                    continue
                scripcode = str(row.get("scripcode") or row.get("strSricpCode") or row.get("ScripCode") or "").strip()
                short_name = str(row.get("shortName") or row.get("SCRIPNAME") or row.get("scrip_name") or row.get("text") or "").strip()
                key = (scripcode, short_name)
                if key in seen:
                    continue
                seen.add(key)
                candidates.append(row)
        except Exception:
            continue

    return candidates


def _resolve_scripcode(sess: requests.Session, row: Dict[str, str]) -> Tuple[Optional[str], str]:
    code = row["target_input_code"]
    company_name = row["target_input_company_name"]

    if _is_numeric_code(code):
        return code, company_name

    queries = [company_name, code]
    candidates: List[Dict[str, Any]] = []
    for query in queries:
        candidates.extend(_search_candidates(sess, query))

    if not candidates:
        return None, company_name

    target_code_norm = _normalize(code)
    target_name_norm = _normalize(company_name)
    best_score = -1
    best_row: Optional[Dict[str, Any]] = None

    for candidate in candidates:
        candidate_code = str(candidate.get("scripcode") or candidate.get("strSricpCode") or candidate.get("ScripCode") or "").strip()
        candidate_name = str(candidate.get("scripName") or candidate.get("shortName") or candidate.get("scrip_name") or candidate.get("text") or candidate.get("extra") or "").strip()
        candidate_short = str(candidate.get("shortName") or "").strip()
        candidate_extra = str(candidate.get("extra") or "").strip()
        candidate_code_norm = _normalize(candidate_code)
        candidate_name_norm = _normalize(candidate_name)
        candidate_short_norm = _normalize(candidate_short)
        candidate_extra_norm = _normalize(candidate_extra)

        score = 0
        if candidate_code_norm and candidate_code_norm == target_code_norm:
            score += 8
        if candidate_short_norm and candidate_short_norm == target_code_norm:
            score += 6
        if candidate_name_norm and candidate_name_norm == target_name_norm:
            score += 8
        if candidate_extra_norm and candidate_extra_norm == target_name_norm:
            score += 6
        if target_code_norm and target_code_norm in candidate_name_norm:
            score += 2
        if target_name_norm and target_name_norm in candidate_name_norm:
            score += 3

        if score > best_score and candidate_code:
            best_score = score
            best_row = candidate

    if not best_row:
        best_row = candidates[0]

    resolved_code = str(best_row.get("scripcode") or best_row.get("strSricpCode") or best_row.get("ScripCode") or "").strip() or None
    resolved_name = str(best_row.get("scripName") or best_row.get("shortName") or best_row.get("scrip_name") or company_name).strip()
    return resolved_code, resolved_name or company_name


def _fetch_annual_reports(sess: requests.Session, scripcode: str) -> List[Dict[str, Any]]:
    response = sess.get(
        f"{API_BASE}/AnnualReport_New/w",
        params={"scripcode": scripcode},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    table = payload.get("Table") if isinstance(payload, dict) else []
    return table if isinstance(table, list) else []


def _build_record(seed_row: Dict[str, str], resolved_name: str, report: Dict[str, Any]) -> Dict[str, Any]:
    def t(value: Any) -> str:
        return "" if value is None else str(value)

    return {
        **seed_row,
        "Scripcode": t(report.get("Scripcode") or seed_row["target_input_code"]),
        "scrip_name": t(report.get("scrip_name") or resolved_name or seed_row["target_input_company_name"]),
        "Year": t(report.get("Year")),
        "PDFDownload": t(report.get("PDFDownload")),
        "Flag": t(report.get("Flag")),
        "StatusForDelisted": t(report.get("StatusForDelisted")),
        "StatusForSuS": t(report.get("StatusForSuS")),
        "REV_DT": t(report.get("REV_DT")),
        "DT_OF_SUS": t(report.get("DT_OF_SUS")),
        "Priorityflag": t(report.get("Priorityflag")),
        "Fld_AuthoriseDate": t(report.get("Fld_AuthoriseDate")),
        "Fld_ReSubmit": t(report.get("Fld_ReSubmit")),
        "Fld_ResubReason": t(report.get("Fld_ResubReason")),
        "revised_date_time": t(report.get("revised_date_time")),
        "status": t(report.get("status") or "New"),
        "RN": t(report.get("RN")),
        "isSpecial": t(report.get("isSpecial")),
    }


def run(context: Dict[str, Any] | None = None) -> Dict[str, Any]:
    context = context or {}
    seed_rows = _load_seed_rows()
    if not seed_rows:
        raise ValueError("BSE input file does not contain any data rows")

    sess = _session()
    records: List[Dict[str, Any]] = []
    resolved_rows = 0
    unresolved_rows: List[str] = []

    for seed_row in seed_rows:
        resolved_code, resolved_name = _resolve_scripcode(sess, seed_row)
        if not resolved_code:
            unresolved_rows.append(seed_row["target_input_company_name"] or seed_row["target_input_code"])
            records.append(
                {
                    **seed_row,
                    "Scripcode": seed_row["target_input_code"],
                    "scrip_name": resolved_name,
                    "Year": "N/A",
                    "PDFDownload": "N/A",
                    "Flag": "",
                    "StatusForDelisted": "",
                    "StatusForSuS": "",
                    "REV_DT": "",
                    "DT_OF_SUS": "",
                    "Priorityflag": "",
                    "Fld_AuthoriseDate": "",
                    "Fld_ReSubmit": "",
                    "Fld_ResubReason": "",
                    "revised_date_time": "",
                    "status": "No Result",
                    "RN": "",
                    "isSpecial": "",
                    "error_message": "Could not resolve BSE scrip code",
                }
            )
            continue

        try:
            reports = _fetch_annual_reports(sess, resolved_code)
        except Exception as exc:
            unresolved_rows.append(seed_row["target_input_company_name"] or seed_row["target_input_code"])
            records.append(
                {
                    **seed_row,
                    "Scripcode": resolved_code,
                    "scrip_name": resolved_name,
                    "Year": "N/A",
                    "PDFDownload": "N/A",
                    "Flag": "",
                    "StatusForDelisted": "",
                    "StatusForSuS": "",
                    "REV_DT": "",
                    "DT_OF_SUS": "",
                    "Priorityflag": "",
                    "Fld_AuthoriseDate": "",
                    "Fld_ReSubmit": "",
                    "Fld_ResubReason": "",
                    "revised_date_time": "",
                    "status": "No Result",
                    "RN": "",
                    "isSpecial": "",
                    "error_message": str(exc),
                }
            )
            continue

        if not reports:
            unresolved_rows.append(seed_row["target_input_company_name"] or seed_row["target_input_code"])
            records.append(
                {
                    **seed_row,
                    "Scripcode": resolved_code,
                    "scrip_name": resolved_name,
                    "Year": "N/A",
                    "PDFDownload": "N/A",
                    "Flag": "",
                    "StatusForDelisted": "",
                    "StatusForSuS": "",
                    "REV_DT": "",
                    "DT_OF_SUS": "",
                    "Priorityflag": "",
                    "Fld_AuthoriseDate": "",
                    "Fld_ReSubmit": "",
                    "Fld_ResubReason": "",
                    "revised_date_time": "",
                    "status": "No Result",
                    "RN": "",
                    "isSpecial": "",
                    "error_message": "No annual reports returned",
                }
            )
            continue

        resolved_rows += 1
        for report in reports:
            records.append(_build_record(seed_row, resolved_name, report))

    if not records:
        raise ValueError("BSE bot completed but did not produce any output records")

    return {
        "records": records,
        "execution_metadata": {
            "bot_name": "Bombay Stock Exchange",
            "source": PAGE_URL,
            "api_base": API_BASE,
            "input_rows_count": len(seed_rows),
            "resolved_rows_count": resolved_rows,
            "unresolved_rows": unresolved_rows,
            "records_count": len(records),
            "runtime_type": "python",
            "entrypoint_file": "run.py",
            "endpoint": "AnnualReport_New/w",
        },
    }
