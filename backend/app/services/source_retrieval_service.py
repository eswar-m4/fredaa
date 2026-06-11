"""
Intelligent live source retrieval service for F.R.E.D.A.

Performs real internet search with semantic ranking and confidence scoring.
"""

import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from duckduckgo_search import DDGS
from rapidfuzz import fuzz

from app.core.logger import setup_logger

logger = setup_logger(__name__)


class SourceRetrievalService:
    """Service that performs intelligent live retrieval with semantic ranking."""

    def __init__(self) -> None:
        self.ddgs = DDGS()
        self.max_results = 5

    def retrieve(
        self,
        source_candidates: List[Dict[str, Any]],
        processed_results: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        start = time.time()
        all_results: List[Dict[str, Any]] = []

        for processed in processed_results:
            if processed.get("status") != "success" or not processed.get("result"):
                continue

            unified = processed["result"]
            entity_name = self._extract_entity_name(unified)
            entity_type = unified.entity_type
            attributes = unified.attributes or {}

            if not entity_name:
                continue

            try:
                queries = self._generate_queries(entity_name, entity_type, attributes)
                for query in queries:
                    search_results = self._search_duckduckgo(query, entity_name)
                    all_results.extend(search_results)
            except Exception as exc:
                logger.warning(f"Search retrieval error for entity '{entity_name}': {exc}")

        ranked_results = self._rank_by_relevance(all_results, entity_name if all_results else "")
        ranked_results = self._dedupe(ranked_results)
        top_results = ranked_results[: self.max_results]

        duration_ms = int((time.time() - start) * 1000)
        logger.info(f"Live source retrieval returned {len(top_results)} ranked results in {duration_ms}ms")
        return top_results

    def _extract_entity_name(self, unified: Any) -> Optional[str]:
        if unified.attributes.get("name"):
            return str(unified.attributes["name"]).strip()
        for key in ["company", "organization", "supplier", "product"]:
            if unified.attributes.get(key):
                return str(unified.attributes[key]).strip()
        if unified.primary_entity:
            return str(unified.primary_entity).strip()
        return None

    def _generate_queries(self, entity_name: str, entity_type: Optional[str], attributes: Dict[str, Any]) -> List[str]:
        queries: List[str] = []

        if entity_type and "organization" in entity_type.lower():
            queries.append(entity_name)
            queries.append(f"{entity_name} company")
            queries.append(f"{entity_name} official website")
            if attributes.get("ceo") or attributes.get("founder"):
                ceo = attributes.get("ceo") or attributes.get("founder")
                queries.append(f"{entity_name} {ceo} CEO")
            if attributes.get("location") or attributes.get("industry"):
                location = attributes.get("location", "")
                queries.append(f"{entity_name} {location}".strip())
        elif entity_type and "person" in entity_type.lower():
            queries.append(entity_name)
            queries.append(f"{entity_name} LinkedIn")
            if attributes.get("company"):
                company = attributes.get("company")
                queries.append(f"{entity_name} {company}")
            if attributes.get("title") or attributes.get("role"):
                title = attributes.get("title") or attributes.get("role")
                queries.append(f"{entity_name} {title}")
        else:
            queries.append(entity_name)
            if attributes.get("type"):
                entity_type_attr = attributes.get("type")
                queries.append(f"{entity_name} {entity_type_attr}")

        return [q for q in queries if q and len(q.strip()) > 0]

    def _search_duckduckgo(self, query: str, entity_name: str) -> List[Dict[str, Any]]:
        try:
            results: List[Dict[str, Any]] = []
            search_results = self.ddgs.text(query, max_results=10)

            for idx, result in enumerate(search_results):
                try:
                    title = result.get("title", "")
                    url = result.get("href", "")
                    snippet = result.get("body", "")
                    source_type = self._classify_source(url, title)
                    confidence = self._calculate_confidence(idx, title, entity_name)

                    if not url or not title:
                        continue

                    results.append({
                        "title": title,
                        "url": url,
                        "snippet": snippet,
                        "source_type": source_type,
                        "confidence": confidence,
                        "query_used": query,
                    })
                except Exception as e:
                    logger.warning(f"Error processing search result: {e}")
                    continue

            return results
        except Exception as exc:
            logger.warning(f"DuckDuckGo search error for query '{query}': {exc}")
            return []

    def _classify_source(self, url: str, title: str) -> str:
        url_lower = url.lower()
        title_lower = title.lower()

        if "linkedin.com" in url_lower:
            return "linkedin"
        if "github.com" in url_lower:
            return "social_profile"
        if "twitter.com" in url_lower or "x.com" in url_lower:
            return "social_profile"
        if "facebook.com" in url_lower or "instagram.com" in url_lower:
            return "social_profile"
        if "crunchbase.com" in url_lower or "zoominfo.com" in url_lower or "dnb.com" in url_lower:
            return "business_directory"
        if "sec.gov" in url_lower or "gov" in url_lower:
            return "government_registry"
        if "news" in url_lower or "press" in url_lower or "article" in title_lower:
            return "news"

        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        if domain and not any(x in domain for x in ["search", "wikipedia", "reddit", "quora"]):
            return "company_website"

        return "unknown"

    def _calculate_confidence(self, index: int, title: str, entity_name: str) -> float:
        base_confidence = 0.85 - (index * 0.08)

        semantic_sim = fuzz.token_sort_ratio(entity_name.lower(), title.lower()) / 100.0
        entity_lower = entity_name.lower()
        title_lower = title.lower()

        if entity_lower in title_lower:
            semantic_sim = min(1.0, semantic_sim + 0.15)

        final_confidence = (base_confidence * 0.4) + (semantic_sim * 0.6)
        return round(min(1.0, max(0.15, final_confidence)), 2)

    def _rank_by_relevance(self, results: List[Dict[str, Any]], entity_name: str) -> List[Dict[str, Any]]:
        for result in results:
            title = result.get("title", "")
            url = result.get("url", "")
            source_type = result.get("source_type", "")

            entity_lower = entity_name.lower()
            title_lower = title.lower()
            url_lower = url.lower()

            relevance_boost = 0.0
            if entity_lower == title_lower:
                relevance_boost = 0.25
            elif entity_lower in title_lower:
                relevance_boost = 0.15
            elif entity_lower in url_lower:
                relevance_boost = 0.08

            if source_type == "linkedin":
                relevance_boost += 0.05
            elif source_type == "company_website":
                relevance_boost += 0.08

            result["confidence"] = round(min(1.0, result["confidence"] + relevance_boost), 2)

        return sorted(results, key=lambda x: x["confidence"], reverse=True)

    def _dedupe(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen = set()
        unique: List[Dict[str, Any]] = []

        for item in results:
            url = item.get("url", "").strip().lower()
            if url in seen:
                continue
            seen.add(url)
            unique.append(item)

        return unique


source_retrieval_service = SourceRetrievalService()
