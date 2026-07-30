"""
Weighted source trust scoring for confidence calculations.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from app.core.logger import setup_logger

logger = setup_logger(__name__)

# Higher weight = more trusted source type
TRUST_WEIGHTS: Dict[str, float] = {
    "official_company_website": 1.0,
    "linkedin": 0.88,
    "crunchbase": 0.72,
    "government_registry": 0.85,
    "knowledge_graph": 0.62,
    "business_directory": 0.55,
    "search_result": 0.62,
    "heuristic": 0.45,
    "unknown": 0.4,
}

DOMAIN_HINTS: List[tuple[str, str]] = [
    (r"linkedin\.com", "linkedin"),
    (r"crunchbase\.com", "crunchbase"),
    (r"(gov|sec\.gov|business\.gov)", "government_registry"),
    (r"gleif\.org|api\.gleif\.org", "government_registry"),
    (r"company-information\.service\.gov\.uk|companieshouse\.gov\.uk", "government_registry"),
    (r"wikidata\.org", "knowledge_graph"),
    (r"(yellowpages|yelp|dnb|zoominfo|bbb\.org)", "business_directory"),
]


class SourceTrustService:
    """Classify sources and apply trust-weighted confidence adjustments."""

    def classify_url(self, url: str, *, is_uploaded: bool = False) -> str:
        if is_uploaded:
            return "official_company_website"
        text = (url or "").lower()
        for pattern, source_type in DOMAIN_HINTS:
            if re.search(pattern, text):
                return source_type
        if text.startswith("http") or "." in text:
            return "search_result"
        return "unknown"

    def classify_candidate(self, candidate: Dict[str, Any]) -> str:
        source = (candidate.get("source") or "").lower()
        if source.startswith("heuristic"):
            return "heuristic"
        source_key = (candidate.get("source_key") or "").lower()
        if source_key in {"wikidata"}:
            return "knowledge_graph"
        if source_key in {"gleif", "companies_house", "sec_edgar", "mca_india"}:
            return "government_registry"
        domain = (candidate.get("domain") or "").lower()
        return self.classify_url(domain or candidate.get("url") or "")

    def weight_for_type(self, source_type: str) -> float:
        return TRUST_WEIGHTS.get(source_type, TRUST_WEIGHTS["unknown"])

    def apply_trust_adjustment(
        self,
        base_confidence: int,
        *,
        primary_url: Optional[str],
        is_uploaded_website: bool = False,
        candidates: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        primary_type = self.classify_url(primary_url or "", is_uploaded=is_uploaded_website)
        primary_weight = self.weight_for_type(primary_type)

        candidate_types = []
        if candidates:
            for cand in candidates[:5]:
                ctype = self.classify_candidate(cand)
                candidate_types.append(
                    {
                        "domain": cand.get("domain"),
                        "source_type": ctype,
                        "trust_weight": self.weight_for_type(ctype),
                        "confidence": cand.get("confidence"),
                    }
                )

        # Blend: up to +8 points for official site, penalize low-trust primary
        adjustment = int(round((primary_weight - 0.6) * 20))
        adjusted = max(0, min(100, base_confidence + adjustment))

        return {
            "confidence_score": adjusted,
            "base_confidence": base_confidence,
            "primary_source_type": primary_type,
            "primary_trust_weight": primary_weight,
            "trust_adjustment": adjustment,
            "candidate_trust": candidate_types,
        }


source_trust_service = SourceTrustService()
