"""
Score website discovery candidates using multiple relevance signals.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from rapidfuzz import fuzz

from app.core.logger import setup_logger

logger = setup_logger(__name__)

SIGNIFICANT_GAP_POINTS = 15
DESCRIPTIVE_TOKENS = {
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
    "official",
}
KNOWN_OFFICIAL_DOMAINS = {
    "openai": "openai.com",
    "microsoft": "microsoft.com",
    "shopfy": "shopify.com",
    "shopify": "shopify.com",
    "slack": "slack.com",
    "airbnb": "airbnb.com",
    "databricks": "databricks.com",
    "snowflake": "snowflake.com",
    "spacex": "spacex.com",
}
DOMAIN_ANTI_SIGNALS = (
    "academy",
    "training",
    "learn",
    "blog",
    "support",
    "docs",
    "help",
    "career",
    "careers",
    "store",
    "rental",
    "rentals",
    "home",
    "homes",
    "technology",
    "technologies",
    "affiliate",
)


def _company_slug(company: str) -> str:
    tokens = _company_tokens(company)
    joined = "".join(tokens)
    if joined in KNOWN_OFFICIAL_DOMAINS:
        return KNOWN_OFFICIAL_DOMAINS[joined].split(".")[0]
    for token in tokens:
        if token in KNOWN_OFFICIAL_DOMAINS:
            return KNOWN_OFFICIAL_DOMAINS[token].split(".")[0]
    return tokens[0] if tokens else re.sub(r"[^a-z0-9]+", "", (company or "").lower())


def _company_tokens(company: str) -> List[str]:
    cleaned = re.sub(r"[^a-z0-9\s]+", " ", (company or "").lower())
    return [token for token in cleaned.split() if len(token) >= 2 and token not in DESCRIPTIVE_TOKENS]


def _extract_domain(url: str) -> str:
    if not url:
        return ""
    normalized = url.strip()
    if not normalized.startswith(("http://", "https://")):
        normalized = f"https://{normalized}"
    try:
        parsed = urlparse(normalized)
        domain = (parsed.netloc or parsed.path).lower()
        if domain.startswith("www."):
            domain = domain[4:]
        return domain.split("/")[0].split("?")[0].split("#")[0]
    except Exception:
        return normalized.lower()


def _domain_parts(domain: str) -> tuple[str, str]:
    clean = _extract_domain(domain)
    parts = clean.split(".")
    return (parts[0] if parts else "", parts[-1] if len(parts) > 1 else "")


class WebsiteCandidateScoringService:
    """Score website candidates for auto-selection vs review routing."""

    def score_candidates(
        self,
        company_name: str,
        record: Dict[str, Any],
        candidates: List[Dict[str, Any]],
        scraped_by_url: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        company = (company_name or record.get("company") or record.get("company_name") or "").strip()
        slug = _company_slug(company)
        email = (record.get("email") or "").strip().lower()
        email_domain = email.split("@")[-1] if "@" in email else ""
        uploaded_website = _extract_domain(record.get("website") or record.get("domain") or "")

        scored: List[Dict[str, Any]] = []
        for candidate in candidates:
            url = candidate.get("url") or ""
            domain = candidate.get("domain") or _extract_domain(url)
            metadata = (scraped_by_url or {}).get(url) or {}

            breakdown = self._score_one(
                company=company,
                slug=slug,
                domain=domain,
                candidate=candidate,
                metadata=metadata,
                email_domain=email_domain,
                uploaded_website=uploaded_website,
            )
            scored.append(
                {
                    "url": url,
                    "domain": domain,
                    "title": candidate.get("title") or metadata.get("title") or "",
                    "snippet": candidate.get("snippet") or "",
                    "confidence": breakdown["confidence"],
                    "score_breakdown": breakdown["signals"],
                    "verified": breakdown["confidence"] >= 75,
                }
            )

        scored.sort(key=lambda item: item["confidence"], reverse=True)
        if scored:
            logger.info(
                "[Candidate Scoring] top candidate for '%s': %s (%d%%)",
                company,
                scored[0].get("domain"),
                scored[0].get("confidence"),
            )
            if len(scored) > 1:
                logger.info(
                    "[Candidate Scoring] runner-up: %s (%d%%)",
                    scored[1].get("domain"),
                    scored[1].get("confidence"),
                )
        return scored

    def _score_one(
        self,
        *,
        company: str,
        slug: str,
        domain: str,
        candidate: Dict[str, Any],
        metadata: Dict[str, Any],
        email_domain: str,
        uploaded_website: str,
    ) -> Dict[str, Any]:
        signals: Dict[str, int] = {}
        title = (metadata.get("title") or candidate.get("title") or "").lower()
        description = (metadata.get("meta_description") or metadata.get("description") or candidate.get("snippet") or "").lower()
        page_text = (metadata.get("page_text") or "").lower()
        detected_name = (metadata.get("detected_company_name") or "").lower()
        domain_slug, tld = _domain_parts(domain)
        candidate_path = (urlparse(candidate.get("url") or "").path or "").strip("/")

        # Domain identity is the primary signal. Titles/snippets are supporting evidence only.
        name_title_ratio = fuzz.token_sort_ratio(company.lower(), title) if company and title else 0
        name_domain_ratio = fuzz.partial_ratio(slug, domain_slug) if slug and domain_slug else 0
        name_page_ratio = fuzz.partial_ratio(company.lower(), page_text[:2000]) if company and page_text else 0

        if name_title_ratio >= 80:
            signals["title_match"] = 8
        elif name_title_ratio >= 55:
            signals["title_match"] = 4

        official_domain = KNOWN_OFFICIAL_DOMAINS.get(slug)
        if official_domain and domain == official_domain:
            signals["known_official_domain"] = 70
        elif slug and domain_slug == slug and tld == "com":
            signals["official_root_com"] = 60
        elif slug and domain_slug == slug:
            signals["official_root_domain"] = 42
        elif slug and domain_slug.startswith(slug):
            signals["brand_prefixed_domain"] = 16
        elif slug and slug in domain_slug:
            signals["brand_contained_domain"] = 10
        elif name_domain_ratio >= 70:
            signals["domain_similarity"] = 8

        if name_page_ratio >= 70:
            signals["about_page"] = 15
        elif detected_name and fuzz.token_sort_ratio(company.lower(), detected_name) >= 75:
            signals["about_page"] = 12

        if description and company.lower() in description:
            signals["meta_description"] = 10

        snippet = (candidate.get("snippet") or "").lower()
        if company and company.lower() in snippet:
            signals["snippet_match"] = 6
        if company and company.lower() in title:
            signals["serp_title_match"] = 8
        if candidate.get("domain_token_match") and not candidate.get("is_linkedin"):
            signals["domain_token_match"] = 6

        base_label = domain_slug
        if slug and base_label == slug and domain.endswith(".com"):
            signals["official_com_domain"] = 12
        if domain.endswith(".info") and slug and slug in domain:
            signals["unofficial_tld"] = -35

        if email_domain and domain and (email_domain == domain or email_domain.endswith(domain) or domain.endswith(email_domain)):
            signals["email_domain"] = 15

        if uploaded_website and domain and uploaded_website == domain:
            signals["uploaded_website_match"] = 20

        # Penalize suspicious TLD patterns and keyword-stuffed microsites.
        if domain.endswith((".net", ".org", ".biz", ".xyz", ".info")) and name_domain_ratio < 80 and slug:
            signals["tld_penalty"] = -12
        elif domain.endswith(".com") and slug and slug in domain_slug:
            signals["tld_preference"] = 8

        if slug and domain_slug != slug and any(token in domain_slug for token in DOMAIN_ANTI_SIGNALS):
            signals["microsite_domain_penalty"] = -42
        if slug and len(domain_slug) > len(slug) + 8:
            signals["long_domain_penalty"] = -32
        if len(domain_slug) > 24:
            signals["generated_domain_penalty"] = -25
        if "-" in domain_slug:
            signals["hyphenated_domain_penalty"] = -12
        if candidate_path and candidate_path.lower() not in ("", "/"):
            signals["non_homepage_penalty"] = -14

        if "fake" in domain or "test" in domain:
            signals["suspicious_domain"] = -25

        total = max(0, min(100, sum(signals.values())))
        return {"confidence": total, "signals": signals}

    def decide_selection(
        self,
        scored_candidates: List[Dict[str, Any]],
        *,
        auto_approve_threshold: int,
        min_gap: int = SIGNIFICANT_GAP_POINTS,
        ambiguity_score_gap: int = 5,
        review_threshold: int = 60,
    ) -> Dict[str, Any]:
        if not scored_candidates:
            return {
                "selected": None,
                "auto_select": False,
                "reason": "no_candidates",
                "gap": 0,
                "ambiguous": False,
            }

        top = scored_candidates[0]
        second_conf = scored_candidates[1]["confidence"] if len(scored_candidates) > 1 else 0
        gap = top["confidence"] - second_conf

        ambiguous = (
            len(scored_candidates) > 1
            and gap < ambiguity_score_gap
            and top["confidence"] >= review_threshold
        )

        auto_select = top["confidence"] >= auto_approve_threshold and gap >= min_gap and not ambiguous
        if ambiguous:
            reason = "ambiguous_top_candidates"
        elif top["confidence"] >= auto_approve_threshold and gap < min_gap and len(scored_candidates) > 1:
            reason = "ambiguous_top_candidates"
            ambiguous = True
            auto_select = False
        elif top["confidence"] >= auto_approve_threshold:
            reason = "high_confidence_clear_winner"
        else:
            reason = "below_auto_threshold"

        return {
            "selected": top,
            "auto_select": auto_select,
            "reason": reason,
            "gap": gap,
            "runner_up_confidence": second_conf,
            "ambiguous": ambiguous,
        }


website_candidate_scoring_service = WebsiteCandidateScoringService()
