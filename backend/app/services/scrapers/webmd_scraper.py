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
import requests
from bs4 import BeautifulSoup

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


def scrape_webmd_physicians() -> list:
    """
    Main scraping function. Scrapes 5 WebMD profiles using requests/BeautifulSoup.
    """
    records = []
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    live_count = 0
    scraped_count = 0

    for url in SEED_PHYSICIANS:
        logger.info(f"Attempting fetch of: {url}")
        html = None
        try:
            resp = requests.get(url, headers=headers, timeout=15)
            if resp.status_code == 200:
                html = resp.text
                live_count += 1
                logger.info("Fetch succeeded.")
            else:
                logger.warning(f"Failed to fetch {url}, status code: {resp.status_code}")
        except Exception as e:
            logger.error(f"Error requesting {url}: {e}")

        if html:
            try:
                record = parse_physician_html(html, url)
                if record.get("Primary_Contact_Name"):
                    records.append(record)
                    scraped_count += 1
                    logger.info(f"Successfully scraped and parsed physician: {record['Primary_Contact_Name']}")
            except Exception as e:
                logger.error(f"Error parsing physician HTML for {url}: {e}")

    logger.info(f"live records count: {live_count}")
    logger.info(f"records scraped count: {scraped_count}")

    return records


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
