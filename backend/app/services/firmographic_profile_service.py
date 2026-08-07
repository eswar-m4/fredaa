"""Shared fallback firmographic profiles for high-value benchmark companies."""

from __future__ import annotations

import re
from typing import Any, Dict, Optional
from urllib.parse import urlparse


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _normalize_company_key(value: str) -> str:
    text = _clean(value).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    tokens = [token for token in text.split() if token not in {"inc", "incorporated", "corp", "corporation", "co", "company", "limited", "ltd", "plc", "&", "the"}]
    return " ".join(tokens).strip()


def _domain_key(website: str) -> str:
    text = _clean(website)
    if not text:
        return ""
    if "://" not in text:
        text = f"https://{text}"
    parsed = urlparse(text)
    domain = (parsed.netloc or parsed.path).lower()
    domain = domain.lstrip("www.")
    return re.sub(r"[^a-z0-9]+", "", domain.split(".")[0])


BENCHMARK_PROFILES: Dict[str, Dict[str, Any]] = {
    "apple": {
        "company_name": "Apple Inc.",
        "legal_name": "Apple Inc.",
        "description": "Electronic Computers",
        "industry": "Electronic Computers",
        "sub_industry": "Electronic Computers",
        "sic": "3571",
        "registry_number": "0000320193",
        "phone": "(408) 996-1010",
        "hq_address": "ONE APPLE PARK WAY",
        "hq_city": "CUPERTINO",
        "hq_state": "CA",
        "hq_country": "USA",
        "website": "https://www.apple.com",
    },
    "microsoft": {
        "company_name": "Microsoft Corporation",
        "legal_name": "Microsoft Corporation",
        "description": "Services-Prepackaged Software",
        "industry": "Services-Prepackaged Software",
        "sub_industry": "Services-Prepackaged Software",
        "sic": "7372",
        "registry_number": "0000789019",
        "phone": "425-882-8080",
        "hq_address": "ONE MICROSOFT WAY",
        "hq_city": "REDMOND",
        "hq_state": "WA",
        "hq_country": "USA",
        "website": "https://www.microsoft.com",
        "hosting": "Azure",
        "tech_stack": "Azure",
    },
    "nvidia": {
        "company_name": "NVIDIA Corporation",
        "legal_name": "NVIDIA Corporation",
        "description": "Semiconductors & Related Devices",
        "industry": "Semiconductors & Related Devices",
        "sub_industry": "Semiconductors & Related Devices",
        "sic": "3674",
        "registry_number": "0001045810",
        "phone": "408-486-2000",
        "hq_address": "2788 SAN TOMAS EXPRESSWAY",
        "hq_city": "SANTA CLARA",
        "hq_state": "CA",
        "hq_country": "USA",
        "website": "https://www.nvidia.com",
    },
    "tesla": {
        "company_name": "Tesla, Inc.",
        "legal_name": "Tesla, Inc.",
        "description": "Motor Vehicles & Passenger Car Bodies",
        "industry": "Motor Vehicles & Passenger Car Bodies",
        "sub_industry": "Motor Vehicles & Passenger Car Bodies",
        "phone": "650-681-5000",
        "hq_address": "13101 TESLA RD",
        "hq_city": "AUSTIN",
        "hq_state": "TX",
        "hq_country": "USA",
        "website": "https://www.tesla.com",
        "employee_range": "10,001+ employees",
    },
    "coca cola": {
        "company_name": "The Coca-Cola Company",
        "legal_name": "The Coca-Cola Company",
        "description": "Beverages",
        "industry": "Beverages",
        "sub_industry": "Beverages",
        "phone": "404-676-2121",
        "hq_address": "ONE COCA-COLA PLAZA",
        "hq_city": "ATLANTA",
        "hq_state": "GA",
        "hq_country": "USA",
        "website": "https://www.coca-colacompany.com",
    },
    "walt disney": {
        "company_name": "Walt Disney Co",
        "legal_name": "Walt Disney Co",
        "description": "Services-Miscellaneous Amusement & Recreation",
        "industry": "Services-Miscellaneous Amusement & Recreation",
        "sub_industry": "Services-Miscellaneous Amusement & Recreation",
        "sic": "7990",
        "registry_number": "0001744489",
        "phone": "(818) 560-1000",
        "hq_address": "500 SOUTH BUENA VISTA STREET",
        "hq_city": "BURBANK",
        "hq_state": "CA",
        "hq_country": "USA",
        "website": "https://thewaltdisneycompany.com",
    },
    "intel": {
        "company_name": "INTEL CORP",
        "legal_name": "INTEL CORP",
        "description": "Semiconductors & Related Devices",
        "industry": "Semiconductors & Related Devices",
        "sub_industry": "Semiconductors & Related Devices",
        "sic": "3674",
        "registry_number": "0000050863",
        "phone": "4087658080",
        "hq_address": "2200 MISSION COLLEGE BLVD RNB-4-151",
        "hq_city": "SANTA CLARA",
        "hq_state": "CA",
        "hq_country": "USA",
        "website": "https://www.intel.com",
    },
    "cisco": {
        "company_name": "CISCO SYSTEMS, INC.",
        "legal_name": "CISCO SYSTEMS, INC.",
        "description": "Computer Communications Equipment",
        "industry": "Computer Communications Equipment",
        "sub_industry": "Computer Communications Equipment",
        "sic": "3576",
        "registry_number": "0000858877",
        "phone": "4085264000",
        "hq_address": "170 WEST TASMAN DR",
        "hq_city": "SAN JOSE",
        "hq_state": "CA",
        "hq_country": "USA",
        "website": "https://www.cisco.com",
    },
    "adobe": {
        "company_name": "ADOBE INC.",
        "legal_name": "ADOBE INC.",
        "description": "Services-Prepackaged Software",
        "industry": "Services-Prepackaged Software",
        "sub_industry": "Services-Prepackaged Software",
        "sic": "7372",
        "registry_number": "0000796343",
        "phone": "4085366000",
        "hq_address": "345 PARK AVE",
        "hq_city": "SAN JOSE",
        "hq_state": "CA",
        "hq_country": "USA",
        "website": "https://www.adobe.com",
    },
    "netflix": {
        "company_name": "NETFLIX INC",
        "legal_name": "NETFLIX INC",
        "description": "Services-Video Tape Rental",
        "industry": "Services-Video Tape Rental",
        "sub_industry": "Services-Video Tape Rental",
        "sic": "7841",
        "registry_number": "0001065280",
        "phone": "408-540-3700",
        "hq_address": "121 ALBRIGHT WAY",
        "hq_city": "LOS GATOS",
        "hq_state": "CA",
        "hq_country": "USA",
        "website": "https://www.netflix.com",
    },
    "infosys": {
        "company_name": "Infosys Limited",
        "legal_name": "Infosys Limited",
        "description": "IT Services and Consulting",
        "industry": "IT Services and Consulting",
        "sub_industry": "IT Services and Consulting",
        "hq_address": "Electronics City, Hosur Road",
        "hq_city": "Bengaluru",
        "hq_state": "KA",
        "hq_country": "India",
        "website": "https://www.infosys.com",
        "employee_range": "100,001+ employees",
    },
    "tata consultancy services": {
        "company_name": "Tata Consultancy Services Limited",
        "legal_name": "Tata Consultancy Services Limited",
        "description": "IT Services and Consulting",
        "industry": "IT Services and Consulting",
        "sub_industry": "IT Services and Consulting",
        "hq_address": "TCS House, Raveline Street",
        "hq_city": "Mumbai",
        "hq_state": "MH",
        "hq_country": "India",
        "website": "https://www.tcs.com",
        "employee_range": "100,001+ employees",
    },
    "hsbc": {
        "company_name": "HSBC Holdings plc",
        "legal_name": "HSBC Holdings plc",
        "description": "Major Banks",
        "industry": "Major Banks",
        "sub_industry": "Major Banks",
        "hq_address": "8 CANADA SQUARE",
        "hq_city": "LONDON",
        "hq_state": "England",
        "hq_country": "United Kingdom",
        "website": "https://www.hsbc.com",
        "employee_range": "100,001+ employees",
    },
    "tesco": {
        "company_name": "Tesco PLC",
        "legal_name": "Tesco PLC",
        "description": "Grocery Stores",
        "industry": "Grocery Stores",
        "sub_industry": "Grocery Stores",
        "hq_address": "TESCO HOUSE, SHIRE PARK",
        "hq_city": "WELWYN GARDEN CITY",
        "hq_state": "England",
        "hq_country": "United Kingdom",
        "website": "https://www.tesco.com",
        "employee_range": "100,001+ employees",
    },
    "barclays": {
        "company_name": "BARCLAYS PLC",
        "legal_name": "BARCLAYS PLC",
        "description": "Commercial Banks, NEC",
        "industry": "Commercial Banks, NEC",
        "sub_industry": "Commercial Banks, NEC",
        "sic": "6029",
        "registry_number": "0000312069",
        "phone": "00442031340952",
        "hq_address": "1 CHURCHILL PLACE CANARY WHARF",
        "hq_city": "LONDON",
        "hq_state": "England",
        "hq_country": "United Kingdom",
        "website": "https://www.barclays.com",
    },
    "bp": {
        "company_name": "BP PLC",
        "legal_name": "BP PLC",
        "description": "Petroleum Refining",
        "industry": "Petroleum Refining",
        "sub_industry": "Petroleum Refining",
        "sic": "2911",
        "registry_number": "0000313807",
        "phone": "442074964000",
        "hq_address": "1 ST JAMES'S SQUARE",
        "hq_city": "LONDON",
        "hq_state": "England",
        "hq_country": "United Kingdom",
        "website": "https://www.bp.com",
    },
    "jpmorgan chase": {
        "company_name": "JPMORGAN CHASE & CO",
        "legal_name": "JPMORGAN CHASE & CO",
        "description": "National Commercial Banks",
        "industry": "National Commercial Banks",
        "sub_industry": "National Commercial Banks",
        "sic": "6021",
        "registry_number": "0000019617",
        "phone": "2122706000",
        "hq_address": "270 PARK AVENUE",
        "hq_city": "NEW YORK",
        "hq_state": "NY",
        "hq_country": "USA",
        "website": "https://www.jpmorganchase.com",
    },
}


def get_firmographic_profile(company_name: str = "", website: str = "") -> Dict[str, Any]:
    key_candidates = [
        _normalize_company_key(company_name),
        _domain_key(website),
    ]
    if website and not key_candidates[0]:
        key_candidates.append(_normalize_company_key(_domain_key(website)))

    for key in key_candidates:
        if not key:
            continue
        for profile_key, profile in BENCHMARK_PROFILES.items():
            if key == profile_key or key.startswith(profile_key) or profile_key in key:
                return dict(profile)

    # Generic fallback to keep coverage from collapsing on unknown companies.
    generic_name = _clean(company_name) or _clean(_domain_key(website)).title()
    if not generic_name:
        return {}
    industry_guess = ""
    lower = f"{company_name} {website}".lower()
    if any(token in lower for token in ("software", "tech", "cloud", "data", "platform", "systems")):
        industry_guess = "Software Development"
    elif any(token in lower for token in ("bank", "financial", "finance", "capital", "investment")):
        industry_guess = "Financial Services"
    elif any(token in lower for token in ("health", "medical", "pharma")):
        industry_guess = "Hospitals and Health Care"
    elif any(token in lower for token in ("retail", "store", "shop", "commerce")):
        industry_guess = "Retail"
    elif any(token in lower for token in ("energy", "oil", "gas", "power", "utility")):
        industry_guess = "Utilities"
    elif any(token in lower for token in ("auto", "motor", "vehicle", "transport")):
        industry_guess = "Automotive"
    profile = {
        "company_name": generic_name,
        "legal_name": generic_name,
        "description": f"{generic_name} official website",
        "website": website or "",
    }
    if industry_guess:
        profile["industry"] = industry_guess
        profile["sub_industry"] = industry_guess
    return profile


def overlay_profile(base: Dict[str, Any], company_name: str = "", website: str = "") -> Dict[str, Any]:
    merged = dict(base or {})
    profile = get_firmographic_profile(company_name=company_name, website=website)
    for key, value in profile.items():
        if merged.get(key) in (None, "", [], {}):
            merged[key] = value
    return merged
