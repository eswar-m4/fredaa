"""
Human-readable confidence explanations for workflow results.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from rapidfuzz import fuzz

from app.services.scrapers.website_scraper import normalize_company_name


class ConfidenceExplainabilityService:
    """Generate confidence_reasons from verification signals."""

    def build(
        self,
        *,
        record: Dict[str, Any],
        confidence: int,
        matched_fields: List[str],
        scraped_metadata: Dict[str, Any],
        comparison: Dict[str, Any],
        website_candidates: List[Dict[str, Any]],
        ambiguous: bool,
        discovery_used: bool,
        trust_info: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        reasons: List[str] = []
        company = record.get("company") or ""
        uploaded_website = record.get("website") or ""
        selected_domain = scraped_metadata.get("url") or ""

        if uploaded_website and not discovery_used:
            reasons.append("uploaded website provided for validation")
        elif discovery_used:
            reasons.append("official website discovered via search")

        if "domain_match" in (website_candidates[0].get("score_breakdown") if website_candidates else {}):
            reasons.append("discovered domain closely matches company name")
        elif "website" in matched_fields or "domain_match" in matched_fields:
            reasons.append("official website matched company name")

        detected = scraped_metadata.get("detected_company_name") or ""
        if detected and company:
            sim = fuzz.token_sort_ratio(
                normalize_company_name(company),
                normalize_company_name(detected),
            )
            if sim >= 85:
                reasons.append("scraped company name aligns with uploaded record")
            elif sim < 60 and detected:
                reasons.append("scraped company name differs from uploaded record")

        if scraped_metadata.get("emails"):
            email = record.get("email") or ""
            if email and any(email.split("@")[-1] in e for e in scraped_metadata.get("emails", [])):
                reasons.append("email domain consistent with website")
            elif not email:
                reasons.append("email found on website but missing in upload")

        if scraped_metadata.get("phone_numbers"):
            if record.get("phone"):
                reasons.append("phone number present in upload and website")
            else:
                reasons.append("phone number discovered on website")

        meta_fields = ["title", "meta_description", "emails", "phone_numbers", "detected_company_name"]
        present = sum(1 for f in meta_fields if scraped_metadata.get(f))
        if present >= 3:
            reasons.append("metadata extraction completeness is strong")
        elif present == 0:
            reasons.append("limited metadata available from website")

        if ambiguous:
            reasons.append("multiple domain candidates have similar confidence scores")
        elif website_candidates and len(website_candidates) > 1:
            top = website_candidates[0].get("confidence", 0)
            second = website_candidates[1].get("confidence", 0)
            if top - second < 10 and top >= 70:
                reasons.append("top domain candidates are close in score")

        conflicts = comparison.get("conflicts") or []
        if conflicts:
            reasons.append(f"field conflicts detected: {', '.join(conflicts)}")

        missing = comparison.get("missing_fields") or []
        if missing:
            reasons.append(f"missing fields in upload: {', '.join(missing)}")

        if trust_info:
            ptype = trust_info.get("primary_source_type")
            if ptype:
                reasons.append(f"primary source trust level: {ptype.replace('_', ' ')}")

        if confidence >= 75 and not reasons:
            reasons.append("overall verification signals exceed auto-approval threshold")
        elif confidence < 60:
            reasons.append("confidence below review threshold")

        return list(dict.fromkeys(reasons))[:12]


confidence_explainability_service = ConfidenceExplainabilityService()
