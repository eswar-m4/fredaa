"""
Source discovery service for F.R.E.D.A.

Prepares potential lookup sources for external validation and refresh workflows.
"""

import json
import re
import time
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from app.config import settings
from app.core.logger import setup_logger

logger = setup_logger(__name__)


class SourceDiscoveryService:
    """Service that prepares prioritized source candidates for discovered entities."""

    def __init__(self) -> None:
        self.priority_sources = getattr(
            settings,
            "SOURCE_DISCOVERY_PRIORITIES",
            ["linkedin", "company_website", "government_registry", "business_directory", "user_defined"],
        )

    def discover(
        self,
        processed_results: List[Dict[str, Any]],
        user_defined_sources: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        start = time.time()
        candidates: List[Dict[str, Any]] = []
        entity_names = set()
        dataset_types = set()

        for result in processed_results:
            if result.get("status") != "success" or not result.get("result"):
                continue
            unified = result["result"]
            if unified.attributes.get("name"):
                entity_names.add(str(unified.attributes.get("name")))
            if unified.dataset_type:
                dataset_types.add(unified.dataset_type)

        for entity_name in entity_names:
            candidates.extend(self._build_entity_sources(entity_name))

        for dataset_type in dataset_types:
            if dataset_type:
                candidates.append(self._make_source(
                    "government_registry",
                    f"{dataset_type} government registry lookup"
                ))

        if user_defined_sources:
            candidates.extend(self._build_user_defined_sources(user_defined_sources))

        if not candidates:
            candidates.append(self._make_source(
                "company_website",
                "generic company website lookup"
            ))

        filtered = self._dedupe(candidates)
        duration_ms = int((time.time() - start) * 1000)
        logger.info(f"Source discovery prepared {len(filtered)} candidates in {duration_ms}ms")
        return filtered

    def _build_entity_sources(self, entity_name: str) -> List[Dict[str, Any]]:
        normalized = entity_name.strip()
        return [
            self._make_source("linkedin", f"{normalized} LinkedIn"),
            self._make_source("company_website", f"{normalized}.com"),
            self._make_source("government_registry", f"{normalized} business registration"),
            self._make_source("business_directory", f"{normalized} business directory"),
        ]

    def _build_user_defined_sources(self, sources: List[str]) -> List[Dict[str, Any]]:
        parsed = []
        for raw_source in sources:
            value = str(raw_source).strip()
            if not value:
                continue
            source_type = self._classify_custom_source(value)
            parsed.append(self._make_source(source_type, value))
        return parsed

    def _classify_custom_source(self, value: str) -> str:
        text = value.lower()
        if re.search(r"linkedin\.com", text):
            return "linkedin"
        if re.search(r"(gov|registry|government|sec|business\.gov)", text):
            return "government_registry"
        if re.search(r"(directory|list|yellowpages|yelp|dnb|zoominfo)", text):
            return "business_directory"
        if re.match(r"https?://", text) or "." in text:
            return "company_website"
        return "user_defined"

    def _make_source(self, source_type: str, query: str) -> Dict[str, Any]:
        return {
            "source_type": source_type,
            "query": query,
            "priority": self._get_priority(source_type),
        }

    def _get_priority(self, source_type: str) -> int:
        try:
            return self.priority_sources.index(source_type) + 1
        except ValueError:
            return len(self.priority_sources) + 1

    def _dedupe(self, candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen = set()
        unique: List[Dict[str, Any]] = []
        for item in candidates:
            key = (item["source_type"], item["query"].strip().lower())
            if key in seen:
                continue
            seen.add(key)
            unique.append(item)
        return unique


source_discovery_service = SourceDiscoveryService()
