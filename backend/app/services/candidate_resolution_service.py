"""
Candidate resolution service for F.R.E.D.A.

Creates ranked candidate match suggestions for extracted entities.
"""

import re
import time
from typing import Any, Dict, List, Optional
from rapidfuzz import fuzz

from app.core.logger import setup_logger

logger = setup_logger(__name__)


class CandidateResolutionService:
    """Service that generates candidate matches from normalized entities."""

    def resolve(
        self,
        processed_results: List[Dict[str, Any]],
        source_candidates: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        start = time.time()
        matches: List[Dict[str, Any]] = []

        for entry in processed_results:
            if entry.get("status") != "success" or not entry.get("result"):
                continue
            unified = entry["result"]
            base_name = self._extract_entity_name(unified)
            if not base_name:
                continue

            candidate_texts = self._build_candidate_variations(
                base_name, unified.entity_type, unified.dataset_type
            )

            for candidate_name in candidate_texts:
                confidence = self._score_candidate(base_name, candidate_name, source_candidates)
                if confidence < 0.2:
                    continue
                matches.append({
                    "candidate_name": candidate_name,
                    "confidence": round(confidence, 2),
                    "reason": self._build_reason(base_name, candidate_name, source_candidates),
                    "source_type": self._match_candidate_source(candidate_name, source_candidates),
                })

        if not matches:
            fallback = {
                "candidate_name": "Unknown candidate",
                "confidence": 0.32,
                "reason": "Low-confidence entity extraction; candidate suggestions are generic.",
            }
            matches.append(fallback)

        sorted_matches = sorted(matches, key=lambda item: item["confidence"], reverse=True)
        top_matches = sorted_matches[:10]
        duration_ms = int((time.time() - start) * 1000)
        logger.info(f"Candidate resolution generated {len(top_matches)} matches in {duration_ms}ms")
        return top_matches

    def _extract_entity_name(self, unified: Any) -> Optional[str]:
        if unified.attributes.get("name"):
            return str(unified.attributes["name"]).strip()
        for key in ["company", "organization", "supplier", "product"]:
            if unified.attributes.get(key):
                return str(unified.attributes[key]).strip()
        if unified.primary_entity:
            return str(unified.primary_entity).strip()
        if unified.dataset_type:
            return str(unified.dataset_type).strip()
        return None

    def _build_candidate_variations(
        self,
        base_name: str,
        entity_type: Optional[str],
        dataset_type: Optional[str],
    ) -> List[str]:
        base = base_name.strip()
        variations = [base]

        if entity_type and "organization" in entity_type.lower():
            variations.extend([
                f"{base} Inc",
                f"{base} LLC",
                f"{base} Corporation",
                f"{base} Group",
                f"{base} Labs",
            ])
        elif entity_type and "person" in entity_type.lower():
            tokens = base.split()
            if len(tokens) > 1:
                variations.extend([
                    base,
                    f"{tokens[-1]} {tokens[0]}",
                    f"{base} (Profile)",
                    f"{base} LinkedIn",
                ])
            else:
                variations.append(f"{base} Profile")
                variations.append(f"{base} LinkedIn")
        elif entity_type and "product" in entity_type.lower():
            variations.extend([
                f"{base} Product",
                f"{base} SKU",
                f"{base} Item",
            ])
        else:
            if dataset_type:
                variations.append(f"{base} {dataset_type}")
            variations.append(f"{base} candidate")

        return list(dict.fromkeys(variations))

    def _score_candidate(
        self,
        base_name: str,
        candidate_name: str,
        source_candidates: List[Dict[str, Any]],
    ) -> float:
        score = fuzz.token_sort_ratio(base_name.lower(), candidate_name.lower()) / 100.0
        if self._has_source_agreement(base_name, source_candidates):
            score += 0.05
        return min(score, 1.0)

    def _has_source_agreement(
        self,
        base_name: str,
        source_candidates: List[Dict[str, Any]],
    ) -> bool:
        lower_base = base_name.lower()
        for source in source_candidates:
            if lower_base in source.get("query", "").lower():
                return True
        return False

    def _build_reason(
        self,
        base_name: str,
        candidate_name: str,
        source_candidates: List[Dict[str, Any]],
    ) -> str:
        if candidate_name.lower() == base_name.lower():
            return "Exact semantic entity match."
        if self._has_source_agreement(base_name, source_candidates):
            return "Strong semantic similarity and source agreement."
        return "Semantic candidate suggestion based on normalized entity context."

    def _match_candidate_source(
        self,
        candidate_name: str,
        source_candidates: List[Dict[str, Any]],
    ) -> Optional[str]:
        lower_candidate = candidate_name.lower()
        for source in source_candidates:
            source_type = source.get("source_type")
            query = str(source.get("query", "")).lower()
            if source_type in ["linkedin", "company_website"]:
                if query in lower_candidate:
                    return source_type
                if self._is_source_name_match(lower_candidate, query):
                    return source_type
        return None

    def _is_source_name_match(self, candidate_name: str, source_query: str) -> bool:
        candidate_normalized = re.sub(r"[^a-z0-9]+", " ", candidate_name.lower()).strip()
        query_normalized = re.sub(r"[^a-z0-9]+", " ", source_query.lower()).strip()
        if not candidate_normalized or not query_normalized:
            return False
        return fuzz.token_sort_ratio(candidate_normalized, query_normalized) >= 70


candidate_resolution_service = CandidateResolutionService()
