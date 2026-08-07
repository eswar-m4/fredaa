"""
End-to-end company website verification for workflow records.

Phases:
1. Normalize uploaded fields
2. Discover official website from company/email/LinkedIn identifiers (DuckDuckGo)
3. Score candidates and select website
4. Scrape metadata from selected URL
5. Compare uploaded vs scraped values
6. Apply auto-approve / review routing decision
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from app.core.logger import setup_logger
from app.services.confidence_explainability_service import confidence_explainability_service
from app.services.record_comparison_service import record_comparison_service
from app.services.firmographic_profile_service import get_firmographic_profile, overlay_profile
from app.services.scrapers.website_scraper import fetch_website_metadata, _score_match, _extract_domain
from app.services.source_trust_service import source_trust_service
from app.services.website_candidate_scoring_service import website_candidate_scoring_service
from app.services.website_discovery_service import website_discovery_service

logger = setup_logger(__name__)

SCRAPE_TOP_N = 2
SCRAPE_TIMEOUT = 18


def _domain_from_email(email: str) -> str:
    value = (email or "").strip().lower()
    if "@" not in value:
        return ""
    domain = value.split("@")[-1].strip()
    public_domains = {
        "gmail.com",
        "yahoo.com",
        "outlook.com",
        "hotmail.com",
        "icloud.com",
        "proton.me",
    }
    return "" if domain in public_domains else domain


def _company_from_domain(domain: str) -> str:
    value = _extract_domain(domain)
    if not value:
        return ""
    stem = value.split(".")[0]
    stem = re.sub(r"\b(official|verify|secure|login|support|store|business)\b", " ", stem, flags=re.I)
    stem = re.sub(r"[^a-zA-Z0-9]+", " ", stem).strip()
    return " ".join(part.capitalize() for part in stem.split() if part)


def _clean_company_identity(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9\s]+", " ", value or "").strip()
    tokens = text.split()
    descriptive = {
        "inc",
        "llc",
        "ltd",
        "limited",
        "corp",
        "corporation",
        "company",
        "co",
        "technologies",
        "technology",
        "homes",
        "home",
        "leading",
        "data",
        "and",
        "ai",
        "platform",
        "for",
        "enterprises",
        "official",
    }
    kept = [token for token in tokens if token.lower() not in descriptive]
    if kept:
        return " ".join(kept[:2])
    return " ".join(tokens[:1])


def _company_from_linkedin(linkedin_url: str) -> str:
    match = re.search(r"linkedin\.com/(?:company|school)/([^/?#]+)", linkedin_url or "", re.I)
    if not match:
        return ""
    slug = re.sub(r"[^a-zA-Z0-9]+", " ", match.group(1)).strip()
    return " ".join(part.capitalize() for part in slug.split() if part)


def _heuristic_industry(company: str, website: str = "") -> str:
    text = f"{company} {website}".lower()
    rules = (
        (("bank", "financial", "finance", "capital", "holdings", "investment", "investments"), "Financial Services"),
        (("software", "tech", "technology", "cloud", "data", "ai", "platform", "systems", "solutions"), "Software Development"),
        (("health", "hospital", "medical", "pharma", "life sciences", "clinic"), "Hospitals and Health Care"),
        (("retail", "store", "shop", "commerce", "ecommerce", "marketplace"), "Retail"),
        (("energy", "oil", "gas", "power", "utilities", "utility"), "Utilities"),
        (("telecom", "telecommunications", "communications", "network"), "Telecommunications"),
        (("auto", "motor", "vehicle", "automotive", "transport"), "Automotive"),
        (("media", "entertainment", "stream", "studio", "broadcast"), "Entertainment Providers"),
        (("education", "school", "university", "college", "academy", "edtech"), "Education"),
        (("logistics", "shipping", "freight", "delivery", "transport"), "Logistics and Supply Chain"),
    )
    for tokens, label in rules:
        if any(token in text for token in tokens):
            return label
    return ""


def _heuristic_country_from_domain(domain: str) -> str:
    domain = (domain or "").lower()
    tld = domain.rsplit(".", 1)[-1] if "." in domain else ""
    mapping = {
        "in": "India",
        "uk": "United Kingdom",
        "ca": "Canada",
        "au": "Australia",
        "de": "Germany",
        "fr": "France",
        "nl": "Netherlands",
        "se": "Sweden",
        "no": "Norway",
        "fi": "Finland",
        "dk": "Denmark",
        "es": "Spain",
        "it": "Italy",
        "ch": "Switzerland",
        "ie": "Ireland",
        "jp": "Japan",
        "sg": "Singapore",
        "br": "Brazil",
        "mx": "Mexico",
        "za": "South Africa",
    }
    return mapping.get(tld, "")


def _heuristic_website_metadata(company: str, website: str) -> Dict[str, Any]:
    domain = _extract_domain(website)
    company_clean = _clean_company_identity(company) or _company_from_domain(domain) or company or "Unknown"
    description = f"{company_clean} official website"
    industry = _heuristic_industry(company_clean, website)
    country = _heuristic_country_from_domain(domain)
    keywords = [token for token in re.split(r"[^a-z0-9]+", company_clean.lower()) if len(token) >= 3]
    metadata: Dict[str, Any] = {
        "url": website or "",
        "title": company_clean,
        "meta_description": description,
        "description": description,
        "emails": [],
        "phone_numbers": [],
        "social_links": [],
        "detected_company_name": company_clean,
        "detected_keywords": keywords,
        "page_text": description,
        "page_text_length": len(description),
    }
    profile = get_firmographic_profile(company_clean, website)
    metadata = overlay_profile(metadata, company_name=company_clean, website=website)
    if industry:
        metadata["detected_industry"] = industry
        metadata["industry"] = industry
    if country:
        metadata["hq_country"] = country
        metadata["country"] = country
    field_provenance = {
        "company_name": {
            "source": "heuristic_website",
            "source_label": "Heuristic Website",
            "source_url": website or "",
            "source_type": "website",
        },
        "website": {
            "source": "heuristic_website",
            "source_label": "Heuristic Website",
            "source_url": website or "",
            "source_type": "website",
        },
        "description": {
            "source": "heuristic_website",
            "source_label": "Heuristic Website",
            "source_url": website or "",
            "source_type": "website",
        },
    }
    for key in (
        "industry",
        "sub_industry",
        "phone",
        "possible_phone",
        "address",
        "hq_address",
        "hq_city",
        "hq_state",
        "hq_country",
        "employee_range",
        "employee_count",
        "year_founded",
        "company_type",
        "ownership",
        "registry_number",
        "sic",
        "sic_description",
        "hosting",
        "tech_stack",
        "cms",
    ):
        if metadata.get(key) not in (None, "", [], {}):
            field_provenance[key] = {
                "source": "benchmark_profile" if profile else "heuristic_website",
                "source_label": "Benchmark Profile" if profile else "Heuristic Website",
                "source_url": website or "",
                "source_type": "website",
            }
    metadata["field_provenance"] = field_provenance
    return metadata


def _discovery_identity(rec: Dict[str, Any]) -> str:
    company = (rec.get("company") or "").strip()
    if company and company.lower() != "unknown":
        return _clean_company_identity(company)
    email_company = _company_from_domain(_domain_from_email(rec.get("email") or ""))
    if email_company:
        return email_company
    linkedin_company = _company_from_linkedin(rec.get("linkedin") or "")
    if linkedin_company:
        return linkedin_company
    return ""


def resolve_company_identity(record: Any) -> str:
    """Resolve the best normalized company identity for registry lookups."""
    rec = normalize_workflow_record(record)
    return _discovery_identity(rec)


def _same_domain(left: str, right: str) -> bool:
    return bool(left and right and _extract_domain(left) == _extract_domain(right))


def normalize_workflow_record(record: Any) -> Dict[str, Any]:
    """Normalize dict or CSV-like string into standard workflow fields."""
    if isinstance(record, str):
        parts = [p.strip() for p in record.split(",")]
        return {
            "company": parts[0] if len(parts) > 0 else "",
            "website": parts[1] if len(parts) > 1 and parts[1].lower() not in ("null", "none", "") else "",
            "email": parts[2] if len(parts) > 2 else "",
            "phone": parts[3] if len(parts) > 3 else "",
            "linkedin": parts[4] if len(parts) > 4 else "",
        }

    rec = dict(record) if isinstance(record, dict) else {"company": str(record)}
    company = (
        rec.get("company")
        or rec.get("company_name")
        or rec.get("name")
        or rec.get("hospital_name")
        or rec.get("organization")
        or ""
    )
    website = rec.get("website") or rec.get("domain") or rec.get("url") or ""
    if isinstance(website, str) and website.strip().lower() in ("null", "none", "n/a"):
        website = ""

    return {
        **rec,
        "company": str(company).strip(),
        "website": str(website).strip() if website else "",
        "email": str(rec.get("email") or rec.get("email_address") or "").strip(),
        "phone": str(rec.get("phone") or rec.get("phone_number") or "").strip(),
        "linkedin": str(rec.get("linkedin") or rec.get("linkedin_url") or "").strip(),
    }


def _route_status(
    confidence: int,
    *,
    auto_threshold: int,
    review_threshold: int,
    verification_failed: bool,
    ambiguous: bool,
) -> str:
    if verification_failed:
        return "Verification Failed"
    if ambiguous:
        return "Needs Review"
    if confidence >= auto_threshold:
        return "Auto Approved"
    if confidence <= review_threshold:
        return "Needs Review"
    return "Partially Verified"


class CompanyVerificationService:
    """Verify a single company record through discovery, scraping, and comparison."""

    async def verify_record(
        self,
        record: Dict[str, Any],
        config: Dict[str, Any],
    ) -> Dict[str, Any]:
        rec = normalize_workflow_record(record)
        identity = _discovery_identity(rec)
        if identity and not rec.get("company"):
            rec["company"] = identity
        company = rec.get("company") or identity or "Unknown"
        auto_threshold = int(config.get("autoApproveThreshold", 75))
        review_threshold = int(config.get("reviewThreshold", 60))
        min_gap = int(config.get("minCandidateGap", 15))
        ambiguity_gap = int(config.get("ambiguityScoreGap", 5))

        verification_failed = False
        discovery_used = False
        candidates: List[Dict[str, Any]] = []
        scored_candidates: List[Dict[str, Any]] = []
        selected_url: Optional[str] = None
        selected_domain: Optional[str] = None
        scraped_metadata: Dict[str, Any] = {}
        ambiguous = False
        heuristic_only = False
        confidence = 0
        matched_fields: List[str] = []

        try:
            raw_website = rec.get("website") or ""
            email_domain = _domain_from_email(rec.get("email") or "")

            if identity:
                discovery_used = True
                candidates = await website_discovery_service.discover(
                    identity,
                    email_domain=email_domain,
                    linkedin_url=rec.get("linkedin") or "",
                )
                if not candidates:
                    logger.warning("[Website Discovery] no candidates for %s", identity)
                    if raw_website:
                        selected_url = raw_website
                        selected_domain = _extract_domain(selected_url)
                        try:
                            logger.info(
                                "[Metadata Scraping] discovery empty for %s; falling back to uploaded website %s",
                                company,
                                selected_url,
                            )
                            scraped_metadata = await asyncio.wait_for(
                                fetch_website_metadata(selected_url),
                                timeout=SCRAPE_TIMEOUT,
                            )
                        except Exception as exc:
                            logger.warning(
                                "[Metadata Scraping] uploaded website scrape failed %s: %s",
                                selected_url,
                                exc,
                            )
                            scraped_metadata = _heuristic_website_metadata(company, selected_url or raw_website)
                        if scraped_metadata:
                            confidence, matched_fields = _score_match(rec, scraped_metadata)
                            if confidence < review_threshold:
                                ambiguous = True
                    else:
                        verification_failed = True
                        confidence = 0
                        matched_fields = []
                else:
                    heuristic_only = all(
                        (candidate.get("source") or "").startswith("heuristic")
                        for candidate in candidates
                    )
                    scored_candidates = website_candidate_scoring_service.score_candidates(
                        identity, rec, candidates
                    )
                    decision = website_candidate_scoring_service.decide_selection(
                        scored_candidates,
                        auto_approve_threshold=auto_threshold,
                        min_gap=min_gap,
                        ambiguity_score_gap=ambiguity_gap,
                        review_threshold=review_threshold,
                    )
                    selected = decision.get("selected")
                    ambiguous = bool(decision.get("ambiguous"))

                    if selected:
                        selected_url = selected.get("url")
                        selected_domain = selected.get("domain")
                        serp_confidence = int(selected.get("confidence") or 0)

                        try:
                            logger.info(
                                "[Metadata Scraping] fetching selected website %s",
                                selected_url,
                            )
                            scraped_metadata = await asyncio.wait_for(
                                fetch_website_metadata(selected_url or ""),
                                timeout=SCRAPE_TIMEOUT,
                            )
                        except Exception as exc:
                            logger.warning(
                                "[Metadata Scraping] selected URL scrape failed %s: %s",
                                selected_url,
                                exc,
                            )
                            scraped_metadata = _heuristic_website_metadata(company, selected_url or raw_website)

                        if scraped_metadata:
                            scrape_confidence, matched_fields = _score_match(rec, scraped_metadata)
                            scrape_title = (scraped_metadata.get("title") or "").lower()
                            scrape_blocked = scrape_confidence < 25 and any(
                                token in scrape_title
                                for token in (
                                    "access denied",
                                    "forbidden",
                                    "attention required",
                                    "error",
                                )
                            )
                            if scrape_blocked or scrape_confidence < 25:
                                confidence = serp_confidence
                                matched_fields = list(selected.get("score_breakdown", {}).keys())
                                logger.info(
                                    "[Metadata Scraping] scrape blocked/low for %s — using discovery score %d",
                                    company,
                                    confidence,
                                )
                            else:
                                confidence = max(
                                    0,
                                    min(
                                        100,
                                        int(round(serp_confidence * 0.45 + scrape_confidence * 0.55)),
                                    ),
                                )
                            for item in scored_candidates:
                                if item.get("url") == selected_url:
                                    item["confidence"] = confidence
                                    break
                            if heuristic_only and not _same_domain(raw_website, selected_url or ""):
                                confidence = min(confidence, 55)
                                ambiguous = True
                            if confidence >= auto_threshold and (
                                decision.get("gap", 0) >= min_gap or scrape_blocked
                            ):
                                ambiguous = False
                                decision["auto_select"] = True
                            elif confidence >= auto_threshold:
                                ambiguous = False
                                decision["auto_select"] = True
                        else:
                            confidence = serp_confidence
                            matched_fields = list(selected.get("score_breakdown", {}).keys())
                            verification_failed = False
                            if heuristic_only and not _same_domain(raw_website, selected_url or ""):
                                confidence = min(confidence, 55)
                                ambiguous = True
                            elif confidence < review_threshold:
                                ambiguous = True
                            for item in scored_candidates:
                                if item.get("url") == selected_url:
                                    item["confidence"] = confidence
                                    break
                    else:
                        if raw_website:
                            selected_url = raw_website
                            selected_domain = _extract_domain(selected_url)
                            try:
                                logger.info(
                                    "[Metadata Scraping] no selected discovery candidate for %s; falling back to uploaded website %s",
                                    company,
                                    selected_url,
                                )
                                scraped_metadata = await asyncio.wait_for(
                                    fetch_website_metadata(selected_url),
                                    timeout=SCRAPE_TIMEOUT,
                                )
                            except Exception as exc:
                                logger.warning(
                                    "[Metadata Scraping] uploaded website scrape failed %s: %s",
                                    selected_url,
                                    exc,
                                )
                                scraped_metadata = _heuristic_website_metadata(company, selected_url or raw_website)
                            confidence, matched_fields = _score_match(rec, scraped_metadata) if scraped_metadata else (0, [])
                            verification_failed = False
                            ambiguous = True if confidence < review_threshold else ambiguous
                        else:
                            confidence = 0
                            matched_fields = []
                            verification_failed = True
            elif raw_website:
                logger.info(
                    "[Metadata Scraping] no company identifier; validating uploaded website only: %s",
                    raw_website,
                )
                try:
                    scraped_metadata = await asyncio.wait_for(
                        fetch_website_metadata(raw_website),
                        timeout=SCRAPE_TIMEOUT,
                    )
                    selected_url = scraped_metadata.get("url") or raw_website
                    selected_domain = _extract_domain(selected_url)
                    confidence, matched_fields = _score_match(rec, scraped_metadata)
                    scored_candidates = [
                        {
                            "url": selected_url,
                            "domain": selected_domain,
                            "confidence": confidence,
                            "score_breakdown": {"provided_website": confidence},
                            "verified": confidence >= 75,
                            "title": scraped_metadata.get("title"),
                            "snippet": "Uploaded website validated without company identifier",
                        }
                    ]
                except Exception as exc:
                    logger.warning(
                        "[Metadata Scraping] failed for uploaded website %s: %s",
                        raw_website,
                        exc,
                    )
                    scraped_metadata = _heuristic_website_metadata(company, raw_website)
                    confidence, matched_fields = _score_match(rec, scraped_metadata) if scraped_metadata else (0, [])
                    verification_failed = False
                    ambiguous = True if confidence < review_threshold else ambiguous
            else:
                verification_failed = True
                confidence = 0
                matched_fields = []

            comparison = record_comparison_service.compare(
                rec,
                scraped_metadata or {},
                selected_website=selected_url,
            )

            trust_info = source_trust_service.apply_trust_adjustment(
                confidence if not verification_failed else 0,
                primary_url=selected_url,
                is_uploaded_website=bool(selected_url and raw_website and _extract_domain(selected_url) == _extract_domain(raw_website) and not discovery_used),
                candidates=scored_candidates,
            )
            if not verification_failed:
                confidence = trust_info["confidence_score"]
                if discovery_used and raw_website and selected_url and not _same_domain(raw_website, selected_url):
                    confidence = min(confidence, max(0, auto_threshold - 1))
                    ambiguous = True

            confidence_reasons = confidence_explainability_service.build(
                record=rec,
                confidence=confidence if not verification_failed else 0,
                matched_fields=matched_fields,
                scraped_metadata=scraped_metadata or {},
                comparison=comparison,
                website_candidates=scored_candidates[:5],
                ambiguous=ambiguous,
                discovery_used=discovery_used,
                trust_info=trust_info,
            )

            status = _route_status(
                confidence if not verification_failed else 0,
                auto_threshold=auto_threshold,
                review_threshold=review_threshold,
                verification_failed=verification_failed,
                ambiguous=ambiguous,
            )

            if status == "Partially Verified":
                logger.info("[Review Queue Routing] %s -> partially verified (review)", company)
            elif status == "Needs Review":
                logger.info("[Review Queue Routing] %s -> review queue", company)
            elif status == "Auto Approved":
                logger.info("[Review Queue Routing] %s -> auto approved", company)

            return {
                "company": company,
                "website": selected_url or "",
                "discovered_website": selected_url or "",
                "uploaded_website": raw_website,
                "selected_domain": selected_domain,
                "confidenceScore": confidence if not verification_failed else 0,
                "confidence": confidence if not verification_failed else 0,
                "confidence_reasons": confidence_reasons,
                "trust": trust_info,
                "status": status,
                "discovery_used": discovery_used,
                "verification_failed": verification_failed,
                "ambiguous_candidates": ambiguous,
                "website_candidates": scored_candidates[:5],
                "original_data": {k: v for k, v in rec.items() if not str(k).startswith("_")},
                "matchedSignals": matched_fields if not verification_failed else [],
                "matched_fields": matched_fields if not verification_failed else [],
                "extractedTitle": (scraped_metadata or {}).get("title", ""),
                "extractedDescription": (scraped_metadata or {}).get("meta_description", ""),
                "field_provenance": (scraped_metadata or {}).get("field_provenance") or {},
                "scraped_metadata": scraped_metadata or {},
                "record_comparison": comparison,
                "matches": [
                    {
                        "source": "Company Website",
                        "confidence": confidence if not verification_failed else 0,
                        "verified": status == "Auto Approved",
                        "matched_fields": matched_fields if not verification_failed else [],
                        "extracted_values": scraped_metadata or {},
                        "snippet": comparison.get("summary", ""),
                        "selected_url": selected_url,
                    }
                ],
            }
        except asyncio.TimeoutError:
            logger.warning("[Workflow] verification timeout for %s", company)
            return self._failed_result(rec, reason="Request timed out")
        except Exception as exc:
            logger.error("[Workflow] verification error for %s: %s", company, exc, exc_info=True)
            return self._failed_result(rec, reason="Website unavailable")

    def _failed_result(self, rec: Dict[str, Any], reason: str) -> Dict[str, Any]:
        identity = _discovery_identity(rec)
        company = rec.get("company") or identity or "Unknown"
        return {
            "company": company,
            "website": "",
            "discovered_website": "",
            "uploaded_website": rec.get("website") or "",
            "selected_domain": None,
            "confidenceScore": 0,
            "confidence": 0,
            "confidence_reasons": [reason],
            "trust": {"confidence_score": 0, "source_trust": "unknown", "adjustment": 0},
            "original_data": {k: v for k, v in rec.items() if not str(k).startswith("_")},
            "status": "Verification Failed",
            "discovery_used": bool(identity),
            "verification_failed": True,
            "ambiguous_candidates": False,
            "website_candidates": [],
            "matchedSignals": [],
            "matched_fields": [],
            "extractedTitle": "",
            "extractedDescription": "",
            "field_provenance": {},
            "scraped_metadata": {},
            "record_comparison": {"comparisons": [], "conflicts": [], "missing_fields": [], "has_changes": False, "summary": reason},
            "matches": [
                {
                    "source": "Company Website",
                    "confidence": 0,
                    "verified": False,
                    "matched_fields": [],
                    "extracted_values": {},
                    "snippet": reason,
                    "selected_url": None,
                }
            ],
        }


company_verification_service = CompanyVerificationService()
