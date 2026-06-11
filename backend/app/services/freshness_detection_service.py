"""
Freshness detection service for F.R.E.D.A.

Compares processed record attributes with newly enriched values and flags stale or changed fields.
"""

import re
import time
from typing import Any, Dict, List, Optional

from app.core.logger import setup_logger

logger = setup_logger(__name__)


class FreshnessDetectionService:
    """Service that evaluates freshness and detects changed or missing values."""

    def analyze(
        self,
        processed_results: List[Dict[str, Any]],
        enriched_data: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        start = time.time()
        current_attributes = self._extract_current_attributes(processed_results)
        if not enriched_data:
            return []

        candidates = [
            {
                "field": "company_name",
                "current_value": current_attributes.get("name"),
                "suggested_value": enriched_data.get("company_name"),
            },
            {
                "field": "email",
                "current_value": current_attributes.get("email"),
                "suggested_value": enriched_data.get("possible_email"),
            },
            {
                "field": "website",
                "current_value": current_attributes.get("website") or current_attributes.get("url"),
                "suggested_value": enriched_data.get("website"),
            },
            {
                "field": "role_title",
                "current_value": current_attributes.get("title") or current_attributes.get("role"),
                "suggested_value": enriched_data.get("role_title"),
            },
            {
                "field": "phone",
                "current_value": current_attributes.get("phone") or current_attributes.get("contact_phone"),
                "suggested_value": enriched_data.get("possible_phone"),
            },
        ]

        analysis: List[Dict[str, Any]] = []
        for candidate in candidates:
            if not candidate["suggested_value"]:
                continue

            current_value = self._normalize(candidate["current_value"])
            suggested_value = self._normalize(candidate["suggested_value"])
            change_detected = False
            confidence = 0.0

            if current_value and suggested_value and current_value != suggested_value:
                change_detected = True
                confidence = 0.92
            elif not current_value and suggested_value:
                change_detected = True
                confidence = 0.72

            if change_detected:
                analysis.append({
                    "field": candidate["field"],
                    "current_value": candidate["current_value"],
                    "suggested_value": candidate["suggested_value"],
                    "change_detected": True,
                    "confidence": round(confidence, 2),
                })

        duration_ms = int((time.time() - start) * 1000)
        logger.info(f"Freshness analysis produced {len(analysis)} entries in {duration_ms}ms")
        return analysis

    def _extract_current_attributes(self, processed_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        for result in processed_results:
            if result.get("status") == "success" and result.get("result"):
                attributes = getattr(result["result"], "attributes", {})
                if isinstance(attributes, dict):
                    return attributes
        return {}

    def _normalize(self, value: Optional[Any]) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        cleaned = re.sub(r"[\s\n\r]+", " ", text)
        return cleaned.lower()


freshness_detection_service = FreshnessDetectionService()
