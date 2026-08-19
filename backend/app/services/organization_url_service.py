"""
Static organization-name to URL resolution.

The mapping is generated from the uploaded reference workbook and stored as
backend/app/data/organization_url_map.json. Runtime code uses this mapping first
and falls back to live discovery when no mapping exists or the mapped URL fails.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

from app.core.logger import setup_logger

logger = setup_logger(__name__)

_MAP_PATH = Path(__file__).resolve().parents[1] / "data" / "organization_url_map.json"


def _normalize_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _normalize_url(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.lower().startswith(("http://", "https://")):
        return text
    return f"https://{text}"


@lru_cache(maxsize=1)
def _load_map() -> Dict[str, List[str]]:
    if not _MAP_PATH.exists():
        logger.warning("Organization URL map missing: %s", _MAP_PATH)
        return {}
    try:
        with _MAP_PATH.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            return {}
        cleaned: Dict[str, List[str]] = {}
        for key, values in payload.items():
            norm_key = _normalize_key(key)
            if not norm_key:
                continue
            urls: List[str] = []
            if isinstance(values, list):
                for value in values:
                    url = _normalize_url(value)
                    if url and url not in urls:
                        urls.append(url)
            elif isinstance(values, str):
                url = _normalize_url(values)
                if url:
                    urls.append(url)
            if urls:
                cleaned[norm_key] = urls
        return cleaned
    except Exception as exc:
        logger.warning("Failed to load organization URL map: %s", exc)
        return {}


def _record_name_candidates(record: Any) -> List[str]:
    if isinstance(record, str):
        return [record]
    if not isinstance(record, dict):
        return [str(record or "")]

    candidates: List[str] = []
    for key in (
        "company",
        "company_name",
        "legal_name",
        "organization",
        "organization_name",
        "fdr_organization_name",
        "name",
        "title",
    ):
        value = record.get(key)
        if value not in (None, "", [], {}):
            candidates.append(str(value))
    return candidates


def resolve_organization_url_candidates(record: Any) -> List[str]:
    """
    Return hardcoded candidate URLs for a record's organization name.

    The first matching name in the workbook mapping wins, but all candidate URLs
    for that organization are returned in priority order.
    """
    mapping = _load_map()
    if not mapping:
        return []

    urls: List[str] = []
    for name in _record_name_candidates(record):
        norm = _normalize_key(name)
        if not norm:
            continue
        for url in mapping.get(norm, []):
            if url not in urls:
                urls.append(url)
    return urls


def resolve_organization_url(record: Any) -> str:
    candidates = resolve_organization_url_candidates(record)
    return candidates[0] if candidates else ""
