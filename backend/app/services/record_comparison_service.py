"""
Compare uploaded dataset fields against scraped website metadata.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from rapidfuzz import fuzz

from app.core.logger import setup_logger
from app.services.scrapers.website_scraper import normalize_company_name

logger = setup_logger(__name__)

FIELD_ALIASES = {
    "company": ["company", "company_name", "name", "organization", "hospital_name"],
    "website": ["website", "domain", "url", "site"],
    "email": ["email", "email_address", "mail"],
    "phone": ["phone", "phone_number", "telephone", "mobile"],
    "linkedin": ["linkedin", "linkedin_url", "linkedin_profile"],
}


def _first_value(record: Dict[str, Any], keys: List[str]) -> Optional[str]:
    for key in keys:
        if key in record and record[key] not in (None, ""):
            return str(record[key]).strip()
    return None


def _normalize_phone(value: str) -> str:
    return re.sub(r"\D+", "", value or "")


def _normalize_url(value: str) -> str:
    v = (value or "").strip().lower()
    v = re.sub(r"^https?://", "", v)
    v = v.lstrip("www.").rstrip("/")
    return v.split("?")[0]


class RecordComparisonService:
    """Detect changes, conflicts, and missing fields between upload and scrape."""

    def compare(
        self,
        uploaded_record: Dict[str, Any],
        scraped_metadata: Dict[str, Any],
        *,
        selected_website: Optional[str] = None,
    ) -> Dict[str, Any]:
        comparisons: List[Dict[str, Any]] = []
        conflicts: List[str] = []
        missing_fields: List[str] = []

        uploaded_website = _first_value(uploaded_record, FIELD_ALIASES["website"])
        scraped_website = selected_website or scraped_metadata.get("url") or ""

        website_cmp = self._compare_field(
            "website",
            _normalize_url(uploaded_website or ""),
            _normalize_url(scraped_website),
            suggested=scraped_website,
            source_url=scraped_website,
        )
        comparisons.append(website_cmp)
        if website_cmp["change_detected"] and uploaded_website:
            conflicts.append("website")

        uploaded_email = _first_value(uploaded_record, FIELD_ALIASES["email"])
        scraped_emails = scraped_metadata.get("emails") or []
        scraped_email = scraped_emails[0] if scraped_emails else scraped_metadata.get("possible_email")
        email_cmp = self._compare_field(
            "email",
            (uploaded_email or "").lower(),
            (scraped_email or "").lower(),
            suggested=scraped_email,
            source_url=scraped_website,
        )
        comparisons.append(email_cmp)
        if email_cmp["change_detected"] and uploaded_email and scraped_email:
            conflicts.append("email")
        if not uploaded_email and scraped_email:
            missing_fields.append("email")

        uploaded_phone = _first_value(uploaded_record, FIELD_ALIASES["phone"])
        scraped_phones = scraped_metadata.get("phone_numbers") or []
        scraped_phone = scraped_phones[0] if scraped_phones else scraped_metadata.get("possible_phone")
        phone_cmp = self._compare_field(
            "phone",
            _normalize_phone(uploaded_phone or ""),
            _normalize_phone(scraped_phone or ""),
            suggested=scraped_phone,
            source_url=scraped_website,
            display_existing=uploaded_phone,
            display_suggested=scraped_phone,
        )
        comparisons.append(phone_cmp)
        if phone_cmp["change_detected"] and uploaded_phone and scraped_phone:
            conflicts.append("phone")
        if not uploaded_phone and scraped_phone:
            missing_fields.append("phone")

        uploaded_company = _first_value(uploaded_record, FIELD_ALIASES["company"])
        scraped_company = scraped_metadata.get("detected_company_name") or ""
        if not scraped_company:
            title_hint = (scraped_metadata.get("title") or "").strip()
            if title_hint and not re.search(
                r"\b(access denied|forbidden|attention required|error|not found)\b",
                title_hint,
                re.I,
            ):
                scraped_company = title_hint
        company_cmp = self._compare_company_name(
            uploaded_company,
            scraped_company,
            source_url=scraped_website,
        )
        comparisons.append(company_cmp)

        if not uploaded_website and scraped_website:
            missing_fields.append("website")

        result = {
            "comparisons": comparisons,
            "conflicts": conflicts,
            "missing_fields": list(dict.fromkeys(missing_fields)),
            "has_changes": any(c["change_detected"] for c in comparisons),
            "summary": self._build_summary(comparisons, conflicts, missing_fields),
        }
        logger.info(
            "[Record Comparison] company=%s changes=%s conflicts=%s",
            uploaded_company or "unknown",
            result["has_changes"],
            conflicts,
        )
        return result

    def _compare_company_name(
        self,
        uploaded: Optional[str],
        scraped: Optional[str],
        *,
        source_url: str,
    ) -> Dict[str, Any]:
        uploaded_display = uploaded or None
        scraped_display = (scraped or "").strip() or None
        uploaded_norm = normalize_company_name(uploaded or "")
        scraped_norm = normalize_company_name(scraped or "")

        if not uploaded_norm and scraped_norm:
            return {
                "field": "company_name",
                "existing_value": uploaded_display,
                "suggested_value": scraped_display,
                "change_detected": True,
                "status": "missing_in_upload",
                "source_url": source_url or None,
                "similarity": 0,
            }

        if not scraped_norm:
            return {
                "field": "company_name",
                "existing_value": uploaded_display,
                "suggested_value": scraped_display,
                "change_detected": False,
                "status": "no_scraped_value",
                "source_url": source_url or None,
                "similarity": 0,
            }

        similarity = fuzz.token_sort_ratio(uploaded_norm, scraped_norm)
        # Treat as match when names are semantically aligned (ignores CTA/marketing phrasing)
        is_match = (
            uploaded_norm == scraped_norm
            or uploaded_norm in scraped_norm
            or scraped_norm in uploaded_norm
            or similarity >= 85
        )

        if is_match:
            return {
                "field": "company_name",
                "existing_value": uploaded_display,
                "suggested_value": scraped_display,
                "change_detected": False,
                "status": "match",
                "source_url": source_url or None,
                "similarity": round(similarity, 1),
            }

        return {
            "field": "company_name",
            "existing_value": uploaded_display,
            "suggested_value": scraped_display,
            "change_detected": True,
            "status": "changed",
            "source_url": source_url or None,
            "similarity": round(similarity, 1),
        }

    def _compare_field(
        self,
        field: str,
        existing_norm: str,
        suggested_norm: str,
        *,
        suggested: Optional[str],
        source_url: str,
        display_existing: Optional[str] = None,
        display_suggested: Optional[str] = None,
    ) -> Dict[str, Any]:
        existing_display = display_existing if display_existing is not None else (existing_norm or None)
        suggested_display = display_suggested if display_suggested is not None else (suggested or None)

        if not existing_norm and suggested_norm:
            change_detected = True
            status = "missing_in_upload"
        elif existing_norm and suggested_norm and existing_norm != suggested_norm:
            change_detected = True
            status = "conflict" if field in ("email", "phone", "website") else "changed"
        elif existing_norm and suggested_norm and existing_norm == suggested_norm:
            change_detected = False
            status = "match"
        else:
            change_detected = False
            status = "no_scraped_value"

        return {
            "field": field,
            "existing_value": existing_display,
            "suggested_value": suggested_display,
            "change_detected": change_detected,
            "status": status,
            "source_url": source_url or None,
        }

    def _build_summary(
        self,
        comparisons: List[Dict[str, Any]],
        conflicts: List[str],
        missing_fields: List[str],
    ) -> str:
        parts = []
        if conflicts:
            parts.append(f"Conflicts: {', '.join(conflicts)}")
        if missing_fields:
            parts.append(f"Missing in upload: {', '.join(missing_fields)}")
        changed = [c["field"] for c in comparisons if c["change_detected"]]
        if changed and not conflicts:
            parts.append(f"Updates suggested: {', '.join(changed)}")
        if not parts:
            return "Uploaded record aligns with scraped metadata."
        return "; ".join(parts)


record_comparison_service = RecordComparisonService()
