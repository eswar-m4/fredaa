#!/usr/bin/env python3
"""
WebMD Scraper for FREDA.
Scrapes WebMD physician profile pages using requests and BeautifulSoup,
extracts profile details from window.__INITIAL_STATE__, and generates sample CSV and Excel files.
"""

import os
import re
import sys
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from app.config import settings

# Setup basic logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Exact 18 columns defined in the source inventory
COLUMNS = [
    "Business_Name", "Address", "City", "State", "Zip",
    "Primary_Phone", "Fax_Phone", "Company_Website",
    "Accepting_New_Patients", "Medicare_Accepted", "Medicaid_Accepted",
    "Primary_Contact_Name", "Year_of_Graduation", "Medical_School",
    "Languages_Spoken", "Hospital_Affiliations", "Specialty", "Detail_Url"
]

SEED_PHYSICIANS = [
    "https://doctor.webmd.com/doctor/dr-aaron-f-kulick-md-40da227b-da51-4b23-9b37-5fa345719ea4-overview",
    "https://doctor.webmd.com/doctor/dr-aananth-raman-md-b5e38f84-77cd-40b5-a00f-0403cbbc1bcd-overview",
    "https://doctor.webmd.com/doctor/dr-aaron-b-sheets-md-d95fb815-3988-46cb-9247-dfc56dc92054-overview",
    "https://doctor.webmd.com/doctor/dr-aaron-j-godshall-md-b9f2b147-d4fb-4946-95c5-563413516010-overview",
    "https://doctor.webmd.com/doctor/dr-aashish-dua-md-4fd2f563-790c-4b7c-9367-0bb7ff165ddd-overview"
]

WEBMD_STATE_SLUGS = {
    "AL": "alabama",
    "AK": "alaska",
    "AZ": "arizona",
    "AR": "arkansas",
    "CA": "california",
    "CO": "colorado",
    "CT": "connecticut",
    "DE": "delaware",
    "FL": "florida",
    "GA": "georgia",
    "HI": "hawaii",
    "ID": "idaho",
    "IL": "illinois",
    "IN": "indiana",
    "IA": "iowa",
    "KS": "kansas",
    "KY": "kentucky",
    "LA": "louisiana",
    "ME": "maine",
    "MD": "maryland",
    "MA": "massachusetts",
    "MI": "michigan",
    "MN": "minnesota",
    "MS": "mississippi",
    "MO": "missouri",
    "MT": "montana",
    "NE": "nebraska",
    "NV": "nevada",
    "NH": "new-hampshire",
    "NJ": "new-jersey",
    "NM": "new-mexico",
    "NY": "new-york",
    "NC": "north-carolina",
    "ND": "north-dakota",
    "OH": "ohio",
    "OK": "oklahoma",
    "OR": "oregon",
    "PA": "pennsylvania",
    "RI": "rhode-island",
    "SC": "south-carolina",
    "SD": "south-dakota",
    "TN": "tennessee",
    "TX": "texas",
    "UT": "utah",
    "VT": "vermont",
    "VA": "virginia",
    "WA": "washington",
    "WV": "west-virginia",
    "WI": "wisconsin",
    "WY": "wyoming",
    "DC": "district-of-columbia",
}

WEBMD_SPECIALTY_SLUGS = {
    "cardiology": "cardiovascular-disease",
    "cardiovascular disease": "cardiovascular-disease",
    "cardiologist": "cardiovascular-disease",
    "cardiologists": "cardiovascular-disease",
    "pediatrics": "pediatrics",
    "pediatrician": "pediatrics",
    "pediatricians": "pediatrics",
    "family medicine": "family-medicine",
    "internal medicine": "internal-medicine",
    "nephrology": "nephrology",
    "nephrologist": "nephrology",
    "pulmonology": "pulmonology",
    "pulmonologist": "pulmonology",
}

WEBMD_SPECIALTY_MATCHERS = {
    "cardiology": ["cardio", "cardiovascular", "cardiologist", "heart"],
    "pediatrics": ["pediatric"],
    "family medicine": ["family medicine"],
    "internal medicine": ["internal medicine"],
    "nephrology": ["nephrology"],
    "pulmonology": ["pulmonology"],
}


@dataclass(frozen=True)
class WebMDScrapeOutcome:
    records: List[dict]
    execution_metadata: Dict[str, Any]


def make_empty_record():
    """Returns a dictionary with all 18 columns initialized to None."""
    return {col: None for col in COLUMNS}


def parse_physician_html(html: str, url: str) -> dict:
    """
    Parses a WebMD physician page HTML and returns a record mapped to the 18-column schema.
    """
    record = make_empty_record()
    record["Detail_Url"] = url

    # Search for window.__INITIAL_STATE__ block
    match = re.search(r'window\.__INITIAL_STATE__\s*=\s*(\{.*?\});?\s*(?:</script>|\n)', html, re.DOTALL)
    if not match:
        logger.warning(f"Could not find window.__INITIAL_STATE__ in {url}")
        return record

    try:
        state = json.loads(match.group(1))
        profile = state.get("profile", {})

        # Doctor's Name (Primary_Contact_Name)
        fullname = profile.get("fullname")
        if fullname:
            if not fullname.lower().startswith("dr."):
                record["Primary_Contact_Name"] = f"Dr. {fullname}"
            else:
                record["Primary_Contact_Name"] = fullname

        # Education & Training
        record["Year_of_Graduation"] = profile.get("graduationYear")
        record["Medical_School"] = profile.get("medicalSchool")

        # Languages Spoken
        langs = profile.get("languagespoken", [])
        if isinstance(langs, list):
            record["Languages_Spoken"] = ", ".join(langs) if langs else None
        else:
            record["Languages_Spoken"] = langs

        # Specialty
        record["Specialty"] = profile.get("specialtynames")

        # Hospital Affiliations
        hospitals = profile.get("hospitalaffiliations", [])
        if isinstance(hospitals, list):
            hosp_names = [h.get("name") for h in hospitals if h.get("name")]
            record["Hospital_Affiliations"] = ", ".join(hosp_names) if hosp_names else None

        # Office Location details
        locations = profile.get("locations", [])
        if locations:
            # We map the first location's office as primary
            first_loc = locations[0]
            record["Business_Name"] = first_loc.get("medicalgroup") or record["Primary_Contact_Name"]
            record["Address"] = first_loc.get("address")
            record["City"] = first_loc.get("city")
            record["State"] = first_loc.get("state")
            record["Zip"] = first_loc.get("zipcode")
            record["Primary_Phone"] = first_loc.get("formattedPhone")
            record["Fax_Phone"] = first_loc.get("Fax")
            record["Company_Website"] = first_loc.get("PracticeWebsite")

            # Patient acceptance & insurance flags
            new_pat = first_loc.get("Newpatient")
            if new_pat is not None:
                record["Accepting_New_Patients"] = "Yes" if new_pat else "No"
            else:
                # Fallback to acceptsnewpatients list
                anp = profile.get("acceptsnewpatients")
                if isinstance(anp, list) and len(anp) > 0:
                    record["Accepting_New_Patients"] = "Yes" if any(anp) else "No"
                elif isinstance(anp, bool):
                    record["Accepting_New_Patients"] = "Yes" if anp else "No"

            medicare = first_loc.get("Medicare")
            if medicare is not None:
                record["Medicare_Accepted"] = "Yes" if medicare else "No"

            medicaid = first_loc.get("Medicaid")
            if medicaid is not None:
                record["Medicaid_Accepted"] = "Yes" if medicaid else "No"

    except Exception as e:
        logger.error(f"Error parsing INITIAL_STATE JSON for {url}: {e}")

    # Clean empty strings to None
    for k in record:
        if record[k] == "":
            record[k] = None

    return record


def _make_http_headers() -> dict:
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }


def _slugify(value: Any) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower())
    return text.strip("-")


def _state_slug(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    upper = raw.upper()
    if upper in WEBMD_STATE_SLUGS:
        return WEBMD_STATE_SLUGS[upper]
    return _slugify(raw)


def _specialty_slug(value: Any) -> Optional[str]:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    if raw in WEBMD_SPECIALTY_SLUGS:
        return WEBMD_SPECIALTY_SLUGS[raw]
    return _slugify(raw)


def _first_value(value: Any) -> Optional[str]:
    if isinstance(value, list):
        if not value:
            return None
        return str(value[0]).strip()
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_bool_string(value: Any) -> Optional[str]:
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {"yes", "true", "1", "y"}:
        return "Yes"
    if text in {"no", "false", "0", "n"}:
        return "No"
    return None


def _record_matches_specialty(record_value: Any, requested_value: Any) -> bool:
    record_text = str(record_value or "").strip().lower()
    requested_text = str(requested_value or "").strip().lower()
    if not requested_text:
        return True
    matcher_key = requested_text
    if matcher_key not in WEBMD_SPECIALTY_MATCHERS:
        matcher_key = "cardiology" if "cardio" in requested_text else requested_text
    candidates = WEBMD_SPECIALTY_MATCHERS.get(matcher_key, [requested_text])
    return any(term in record_text for term in candidates) or requested_text in record_text


def _record_matches_webmd_constraints(record: dict, filters: Dict[str, Any]) -> bool:
    if not filters:
        return True

    specialty = _first_value(filters.get("specialty"))
    state = _first_value(filters.get("state"))
    city = _first_value(filters.get("city"))
    accepting = _normalize_bool_string(filters.get("accepting_new_patients"))
    medicare = _normalize_bool_string(filters.get("medicare_accepted"))
    medicaid = _normalize_bool_string(filters.get("medicaid_accepted"))
    hospital = _first_value(filters.get("hospital_affiliations"))
    languages = _first_value(filters.get("languages_spoken"))
    medical_school = _first_value(filters.get("medical_school"))

    if specialty and not _record_matches_specialty(record.get("Specialty"), specialty):
        return False
    if state:
        state_text = _state_slug(record.get("State"))
        state_alias = _state_slug(state)
        if state_text and state_alias and state_text != state_alias:
            return False
    if city and city.lower() not in str(record.get("City") or "").strip().lower():
        return False
    if accepting and _normalize_bool_string(record.get("Accepting_New_Patients")) != accepting:
        return False
    if medicare and _normalize_bool_string(record.get("Medicare_Accepted")) != medicare:
        return False
    if medicaid and _normalize_bool_string(record.get("Medicaid_Accepted")) != medicaid:
        return False
    if hospital and hospital.lower() not in str(record.get("Hospital_Affiliations") or "").lower():
        return False
    if languages and languages.lower() not in str(record.get("Languages_Spoken") or "").lower():
        return False
    if medical_school and medical_school.lower() not in str(record.get("Medical_School") or "").lower():
        return False
    return True


def _fetch_html(url: str, *, headers: dict, timeout: int = 15) -> Optional[str]:
    try:
        resp = requests.get(url, headers=headers, timeout=timeout)
        if resp.status_code == 200:
            return resp.text
        logger.warning("Failed to fetch %s, status code: %s", url, resp.status_code)
    except Exception as exc:
        logger.error("Error requesting %s: %s", url, exc)
    return None


def _scrape_profile_urls(profile_urls: Iterable[str]) -> List[dict]:
    records: List[dict] = []
    headers = _make_http_headers()
    live_count = 0
    scraped_count = 0
    unique_urls = [url for url in dict.fromkeys(profile_urls) if url]

    if not unique_urls:
        return []

    max_workers = min(8, max(1, len(unique_urls)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_fetch_html, url, headers=headers): url for url in unique_urls}
        for future in as_completed(futures):
            url = futures[future]
            html = None
            try:
                html = future.result()
            except Exception as exc:
                logger.error("Error fetching %s: %s", url, exc)
            if html:
                live_count += 1
                try:
                    record = parse_physician_html(html, url)
                    if record.get("Primary_Contact_Name"):
                        records.append(record)
                        scraped_count += 1
                        logger.info("Successfully scraped and parsed physician: %s", record["Primary_Contact_Name"])
                except Exception as exc:
                    logger.error("Error parsing physician HTML for %s: %s", url, exc)

    logger.info("live records count: %s", live_count)
    logger.info("records scraped count: %s", scraped_count)
    return records


def _discover_webmd_listing_urls(execution_plan: Dict[str, Any]) -> List[str]:
    filters = execution_plan.get("supported_filters") or {}
    url_hints = execution_plan.get("url_hints") or []

    listing_urls: List[str] = []
    for hint in url_hints if isinstance(url_hints, list) else [url_hints]:
        if not hint:
            continue
        hint_text = str(hint).strip()
        if "webmd.com" in hint_text.lower():
            listing_urls.append(hint_text)

    specialty = _first_value(filters.get("specialty"))
    state = _first_value(filters.get("state"))
    city = _first_value(filters.get("city"))

    specialty_slug = _specialty_slug(specialty)
    state_slug = _state_slug(state)
    city_slug = _slugify(city) if city else None

    base = "https://doctor.webmd.com/providers"
    if specialty_slug and state_slug:
        listing_urls.append(f"{base}/specialty/{specialty_slug}/{state_slug}")
        if city_slug:
            listing_urls.append(f"{base}/specialty/{specialty_slug}/{state_slug}/{city_slug}")
    elif specialty_slug:
        listing_urls.append(f"{base}/specialty/{specialty_slug}")
    elif state_slug:
        listing_urls.append(f"{base}/{state_slug}")

    normalized: List[str] = []
    for url in listing_urls:
        clean = str(url).split("#", 1)[0].split("?", 1)[0].strip()
        if clean and clean not in normalized:
            normalized.append(clean)
    return normalized


def _extract_profile_urls_from_listing(listing_html: str, listing_url: str) -> List[str]:
    soup = BeautifulSoup(listing_html, "html.parser")
    profile_urls: List[str] = []
    for anchor in soup.find_all("a", href=True):
        href = urljoin(listing_url, anchor["href"])
        if "doctor.webmd.com/doctor/" not in href:
            continue
        if not href.endswith("-overview"):
            continue
        profile_urls.append(href.split("#", 1)[0].split("?", 1)[0])
    return list(dict.fromkeys(profile_urls))


def _scrape_webmd_listing_pages(listing_urls: Iterable[str]) -> Dict[str, List[str]]:
    headers = _make_http_headers()
    candidate_profile_urls: List[str] = []
    discovery_urls: List[str] = []

    for listing_url in dict.fromkeys(listing_urls):
        html = _fetch_html(listing_url, headers=headers)
        if not html:
            continue
        discovery_urls.append(listing_url)
        candidate_profile_urls.extend(_extract_profile_urls_from_listing(html, listing_url))

    return {
        "discovery_urls": discovery_urls,
        "candidate_profile_urls": list(dict.fromkeys(candidate_profile_urls)),
    }


def scrape_webmd_physicians() -> list:
    """
    Main scraping function. Scrapes 5 WebMD profiles using requests/BeautifulSoup.
    """
    records = _scrape_profile_urls(SEED_PHYSICIANS)
    return records


def execute_webmd_partial_scrape(execution_plan: Dict[str, Any], *, limit: Optional[int] = None) -> WebMDScrapeOutcome:
    """
    Live WebMD partial scrape for planner-generated constraints.
    """
    direct_profile_urls: List[str] = []
    for hint in execution_plan.get("url_hints") or []:
        hint_text = str(hint or "").strip()
        if not hint_text:
            continue
        if "doctor.webmd.com/doctor/" in hint_text and hint_text.endswith("-overview"):
            direct_profile_urls.append(hint_text.split("#", 1)[0].split("?", 1)[0])

    listing_urls = _discover_webmd_listing_urls(execution_plan)
    discovery = _scrape_webmd_listing_pages(listing_urls)
    candidate_profile_urls = list(dict.fromkeys(discovery["candidate_profile_urls"] + direct_profile_urls))
    records = _scrape_profile_urls(candidate_profile_urls)

    filters = execution_plan.get("supported_filters") or {}
    records = [record for record in records if _record_matches_webmd_constraints(record, filters)]
    records = _apply_result_terms(records, execution_plan)

    metadata = {
        "discovery_urls": discovery["discovery_urls"],
        "candidate_profile_urls": candidate_profile_urls,
        "profiles_scanned": len(candidate_profile_urls),
    }
    return WebMDScrapeOutcome(records=records, execution_metadata=metadata)


def _apply_result_terms(records: List[dict], execution_plan: Dict[str, Any]) -> List[dict]:
    include_terms = [str(term).strip().lower() for term in (execution_plan.get("include_terms") or []) if str(term).strip()]
    exclude_terms = [str(term).strip().lower() for term in (execution_plan.get("exclude_terms") or []) if str(term).strip()]
    if not include_terms and not exclude_terms:
        return records

    filtered: List[dict] = []
    for record in records:
        blob = " ".join(
            str(value)
            for value in record.values()
            if value not in (None, "")
        ).lower()
        if include_terms and not all(term in blob for term in include_terms):
            continue
        if exclude_terms and any(term in blob for term in exclude_terms):
            continue
        filtered.append(record)
    return filtered


def generate_sample_files(records: list, base_dir: str):
    """Generates the CSV and XLSX sample files in the given directory."""
    import pandas as pd

    csv_path = os.path.join(base_dir, "sample_webmd.csv")
    xlsx_path = os.path.join(base_dir, "sample_webmd.xlsx")

    # Force exact COLUMNS order and shape
    df = pd.DataFrame(records, columns=COLUMNS)

    # Fill NaN values explicitly with None to match requirement
    df_out = df.where(pd.notnull(df), None)

    # Save CSV
    df_out.to_csv(csv_path, index=False)
    logger.info(f"Saved CSV sample file to: {csv_path}")

    # Save XLSX
    df_out.to_excel(xlsx_path, index=False)
    logger.info(f"Saved XLSX sample file to: {xlsx_path}")

    return csv_path, xlsx_path


def main():
    # Workspace root is three levels up from 'app/services/scrapers'
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    if not os.path.exists(base_dir):
        base_dir = os.getcwd()

    records = scrape_webmd_physicians()
    csv_path, xlsx_path = generate_sample_files(records, base_dir)

    result = {
        "source": "WebMD",
        "records_scraped": len(records),
        "sample_csv": csv_path,
        "sample_xlsx": xlsx_path,
        "records": records
    }

    # Output JSON representation to stdout with ensure_ascii=True to avoid encoding issues on Windows consoles
    print(json.dumps(result, indent=2, ensure_ascii=True))
    return result


if __name__ == "__main__":
    main()
