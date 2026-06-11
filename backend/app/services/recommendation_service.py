"""
Recommendation service for F.R.E.D.A.

Generates enterprise-safe change suggestions based on freshness analysis and enriched data.
"""

from typing import Any, Dict, List

from app.core.logger import setup_logger

logger = setup_logger(__name__)


class RecommendationService:
    """Service that creates ranked suggested changes for human review."""

    def recommend(
        self,
        freshness_analysis: List[Dict[str, Any]],
        enriched_data: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        recommendations: List[Dict[str, Any]] = []
        source_url = enriched_data.get("source_url") or "live retrieval"

        for item in freshness_analysis:
            if not item.get("change_detected"):
                continue

            field = item.get("field")
            current_value = item.get("current_value")
            suggested_value = item.get("suggested_value")
            confidence = item.get("confidence", 0.0)
            reason = self._build_reason(field, current_value, suggested_value, enriched_data)

            recommendations.append({
                "field": field,
                "current_value": current_value,
                "recommended_value": suggested_value,
                "confidence": round(confidence, 2),
                "source": source_url,
                "reason": reason,
            })

        recommendations = sorted(recommendations, key=lambda item: item["confidence"], reverse=True)
        logger.info(f"Recommendation engine created {len(recommendations)} suggestions")
        return recommendations

    def _build_reason(
        self,
        field: str,
        current_value: Any,
        suggested_value: Any,
        enriched_data: Dict[str, Any],
    ) -> str:
        if current_value is None or current_value == "":
            return f"Publicly retrieved source contains a newly discovered value for {field}."

        source_name = enriched_data.get("company_name") or enriched_data.get("website") or "live retrieval"
        return f"Source data from {source_name} indicates the {field} has changed from the current record."


recommendation_service = RecommendationService()
