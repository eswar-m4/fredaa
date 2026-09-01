import asyncio
import hashlib
import os
import json
import re
from collections import Counter
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from app.config import settings
from app.services.company_verification_service import resolve_company_identity
from app.services.scrapers.website_scraper import normalize_company_name
from app.services.source_trust_service import source_trust_service

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_REVIEW_CACHE_DIR = Path(BASE_DIR) / "datasets" / ".review_cache"
_COVERAGE_BLANK_SENTINELS = {"", "-", "—", "–", "null", "nan", "n/a", "na"}
_COVERAGE_META_KEYS = {
    "id",
    "run_id",
    "timestamp",
    "scraped_at",
    "created_at",
    "updated_at",
    "record_id",
    "record_key",
    "recordkey",
    "source",
    "source_url",
    "sourceurl",
    "source_display",
    "conf",
    "confidence",
    "confidence_score",
    "changetype",
    "change_type",
    "changed",
    "previous",
    "value",
    "attribute",
    "attributekey",
    "attribute_key",
}

def clean_domain(url_str: str) -> str:
    if not url_str:
        return "example.com"
    clean = url_str.strip().lower()
    if not clean.startswith("http://") and not clean.startswith("https://"):
        clean = "https://" + clean
    try:
        from urllib.parse import urlparse
        parsed = urlparse(clean)
        host = parsed.netloc or parsed.path
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return url_str

def find_company_website(rec: dict) -> str:
    keys = ["website", "url", "domain", "website_url", "corp_site", "websiteUrl"]
    for k in keys:
        val = rec.get(k)
        if isinstance(val, str) and "." in val and not " " in val:
            return val
    # Fallback to any string value that looks like a URL
    for val in rec.values():
        if isinstance(val, str) and ("http" in val or ("." in val and not " " in val and not "@" in val)):
            return val
    return ""

def _normalize_field_key(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "_").replace("-", "_")

def _pick_original_value(record: Dict[str, Any], *candidates: str) -> Any:
    normalized = {
        _normalize_field_key(key): value
        for key, value in (record or {}).items()
    }
    for candidate in candidates:
        value = normalized.get(_normalize_field_key(candidate))
        if value not in (None, "", [], {}):
            return value
    return None


def _file_signature(path: str) -> str:
    try:
        stat = os.stat(path)
        return f"{stat.st_mtime_ns}:{stat.st_size}"
    except Exception:
        return "missing"


def _review_cache_key(job_id: str, sample_rate: float, signature_parts: List[str]) -> str:
    payload = "|".join([str(job_id), f"{float(sample_rate):.4f}", *signature_parts])
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _read_review_cache(cache_path: Path, signature: str) -> Optional[dict]:
    if not cache_path.exists():
        return None
    try:
        cached = json.loads(cache_path.read_text(encoding="utf-8"))
        if not isinstance(cached, dict):
            return None
        if cached.get("signature") != signature:
            return None
        payload = cached.get("payload")
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _write_review_cache(cache_path: Path, signature: str, payload: dict) -> None:
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps({"signature": signature, "payload": payload}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        # Cache is an optimization only; fall back to recomputing on the next request.
        return


def compact_review_coverage(coverage: Optional[dict]) -> Optional[dict]:
    if not isinstance(coverage, dict):
        return coverage

    def _compact_source_rows(rows: Any) -> List[Dict[str, Any]]:
        compacted: List[Dict[str, Any]] = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            compacted.append({
                "source_key": row.get("source_key"),
                "source_label": row.get("source_label"),
                "records_requested_from_source": row.get("records_requested_from_source"),
                "records_returned_by_source": row.get("records_returned_by_source"),
                "source_coverage": row.get("source_coverage"),
                "filled_fields": [
                    {"attribute_key": field.get("attribute_key")}
                    for field in (row.get("filled_fields") or [])[:12]
                    if isinstance(field, dict) and field.get("attribute_key")
                ],
            })
        return compacted

    def _compact_attribute_rows(rows: Any) -> List[Dict[str, Any]]:
        compacted: List[Dict[str, Any]] = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            compacted.append({
                "attribute_key": row.get("attribute_key"),
                "attribute_label": row.get("attribute_label"),
                "non_null_values": row.get("non_null_values"),
                "total_records_in_scope": row.get("total_records_in_scope"),
                "attr_coverage": row.get("attr_coverage"),
            })
        return compacted

    return {
        "job_coverage": coverage.get("job_coverage"),
        "source_coverage": coverage.get("source_coverage"),
        "record_coverage": coverage.get("record_coverage"),
        "weighted_job_coverage": coverage.get("weighted_job_coverage"),
        "records_in_scope": coverage.get("records_in_scope"),
        "expected_attributes": coverage.get("expected_attributes"),
        "total_filled_cells": coverage.get("total_filled_cells"),
        "source_requested": coverage.get("source_requested"),
        "source_returned": coverage.get("source_returned"),
        "source_kind": coverage.get("source_kind"),
        "source_breakdown": _compact_source_rows(coverage.get("source_breakdown")),
        "attribute_breakdown": _compact_attribute_rows(coverage.get("attribute_breakdown")),
    }


async def warm_review_cache(job_id: str, sample_rate: float = 2.0) -> None:
    try:
        await asyncio.to_thread(get_review_rows, job_id, sample_rate)
    except Exception:
        # Warmup is best-effort only.
        return


_CONFIDENCE_PLACEHOLDERS = {
    "",
    "-",
    "—",
    "–",
    "n/a",
    "na",
    "none",
    "null",
    "unknown",
    "tbd",
    "pending",
    "not available",
}


def _normalize_confidence_text(value: Any) -> str:
    return str(value or "").strip()


def _is_blank_confidence_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, (list, dict, tuple, set)):
        return len(value) == 0
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        try:
            return float(value) != float(value)
        except Exception:
            return False
    return _normalize_confidence_text(value).lower() in _CONFIDENCE_PLACEHOLDERS


def _normalize_company_key(value: Any) -> str:
    text = normalize_company_name(_normalize_confidence_text(value))
    text = re.sub(r"\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|sarl)\b", " ", text, flags=re.I)
    text = re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()
    return " ".join(part for part in text.split() if part)


def _text_similarity(left: str, right: str) -> float:
    left_norm = _normalize_company_key(left)
    right_norm = _normalize_company_key(right)
    if not left_norm or not right_norm:
        return 0.0
    if left_norm == right_norm:
        return 100.0
    if left_norm in right_norm or right_norm in left_norm:
        return 92.0
    return SequenceMatcher(None, left_norm, right_norm).ratio() * 100.0


def _extract_email_domain(value: Any) -> str:
    text = _normalize_confidence_text(value).lower()
    if "@" not in text:
        return ""
    return text.split("@")[-1].strip().strip(".")


def _extract_domain_token(value: Any) -> str:
    domain = clean_domain(_normalize_confidence_text(value))
    if not domain or domain == "example.com":
        return ""
    root = domain.split(".")[0]
    root = re.sub(r"[^a-z0-9]+", " ", root.lower()).strip()
    return " ".join(root.split())


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        try:
            raw = float(value)
            if raw > 1e12:
                raw /= 1000.0
            return datetime.fromtimestamp(raw, tz=timezone.utc)
        except Exception:
            return None
    text = _normalize_confidence_text(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _build_confidence_context(record: Dict[str, Any], attr: str) -> Dict[str, Any]:
    context_record = dict(record or {})
    for key in list(context_record.keys()):
        if _normalize_coverage_key(key) == _normalize_coverage_key(attr):
            context_record.pop(key, None)
    return context_record


def _identity_score(attr: str, value: Any, record: Dict[str, Any], source: str, record_index: int) -> float:
    identity_base = 18.0 if _is_blank_confidence_value(value) else 55.0

    context_record = _build_confidence_context(record, attr)
    identity_source = dict(context_record)
    identity_source["company"] = (
        identity_source.get("company")
        or identity_source.get("company_name")
        or identity_source.get("legal_name")
        or identity_source.get("name")
        or identity_source.get("organization")
        or ""
    )
    derived_identity = _normalize_company_key(resolve_company_identity(identity_source))
    value_text = _normalize_confidence_text(value)
    value_domain = clean_domain(value_text)
    source_url = source or record.get("sourceUrl") or record.get("source_url") or record.get("website") or record.get("url") or ""
    source_domain = clean_domain(source_url)
    source_type = source_trust_service.classify_url(source_url)
    trust_weight = source_trust_service.weight_for_type(source_type) * 100.0

    company_alignment = 0.0
    domain_alignment = 0.0
    source_alignment = 0.0

    if attr in {"website", "website_url", "domain", "url"}:
        company_alignment = _text_similarity(derived_identity, _extract_domain_token(value_text)) if derived_identity else 0.0
        if value_domain and source_domain and value_domain == source_domain:
            domain_alignment = 100.0
        elif value_domain and derived_identity:
            domain_alignment = _text_similarity(derived_identity, _extract_domain_token(value_domain))
        source_alignment = 100.0 if value_domain and source_domain and value_domain == source_domain else 45.0 if value_domain else 0.0
        identity_base = 35.0 if _is_blank_confidence_value(value) else 58.0
    elif attr in {"email", "email_address", "contact_email"}:
        email_domain = _extract_email_domain(value_text)
        company_alignment = _text_similarity(derived_identity, _extract_domain_token(email_domain)) if derived_identity and email_domain else 0.0
        if email_domain and source_domain and email_domain == source_domain:
            domain_alignment = 100.0
        elif email_domain and derived_identity:
            domain_alignment = _text_similarity(derived_identity, _extract_domain_token(email_domain))
        source_alignment = 90.0 if email_domain and source_domain and (email_domain == source_domain or email_domain.endswith(source_domain) or source_domain.endswith(email_domain)) else 30.0 if email_domain else 0.0
        identity_base = 28.0 if _is_blank_confidence_value(value) else 52.0
    elif attr in {"phone", "contact_phone", "phone_number", "telephone", "mobile"}:
        company_alignment = 60.0 if derived_identity else 35.0
        source_alignment = 75.0 if source_domain and source_type == "official_company_website" else 45.0 if source_domain else 20.0
        domain_alignment = 35.0 if derived_identity else 15.0
        identity_base = 24.0 if _is_blank_confidence_value(value) else 48.0
    elif attr in {"company_name", "legal_name", "name", "organization"}:
        company_alignment = _text_similarity(derived_identity, value_text) if derived_identity else 0.0
        value_token = _extract_domain_token(value_text)
        source_token = _extract_domain_token(source_domain)
        domain_alignment = 75.0 if value_token and source_token and value_token in source_token else 30.0 if source_domain else 0.0
        source_alignment = 85.0 if source_type == "official_company_website" else 55.0 if source_domain else 25.0
        identity_base = 32.0 if _is_blank_confidence_value(value) else 60.0
    elif attr in {"hq_address", "address", "street", "hq_city", "hq_state", "hq_country", "country"}:
        company_alignment = 55.0 if derived_identity else 35.0
        source_alignment = 55.0 if source_domain else 25.0
        domain_alignment = 45.0 if value_text and any(token in value_text.lower() for token in ("street", "suite", "road", "city", "state", "country")) else 20.0
        identity_base = 26.0 if _is_blank_confidence_value(value) else 46.0
    else:
        company_alignment = 48.0 if derived_identity else 30.0
        source_alignment = 52.0 if source_domain else 25.0
        domain_alignment = 35.0 if value_text else 10.0

    signal_score = (company_alignment * 0.45) + (domain_alignment * 0.25) + (source_alignment * 0.30)
    trust_bonus = (trust_weight - 40.0) * 0.35
    score = max(identity_base, signal_score + trust_bonus)
    return max(0.0, min(100.0, score))


def _validation_score(attr: str, value: Any) -> float:
    if _is_blank_confidence_value(value):
        return 0.0

    text = _normalize_confidence_text(value)
    attr_key = _normalize_coverage_key(attr)
    lower = text.lower()

    if attr_key in {"website", "website_url", "url", "domain"}:
        if not text:
            return 0.0
        if not re.match(r"^(https?://)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(/.*)?$", lower):
            return 32.0
        return 94.0

    if attr_key in {"email", "contact_email", "email_address"}:
        if not re.match(r"^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$", text, re.I):
            return 18.0
        domain = _extract_email_domain(text)
        if domain and domain.split(".")[-1] in {"com", "org", "net", "gov", "edu", "co", "io", "ai"}:
            return 92.0
        return 82.0

    if attr_key in {"phone", "contact_phone", "phone_number", "telephone", "mobile"}:
        digits = re.sub(r"\D+", "", text)
        if len(digits) < 7:
            return 12.0
        if len(digits) <= 15:
            return 90.0
        return 56.0

    if attr_key in {"year_founded", "founded", "foundation_year"}:
        try:
            year = int(re.sub(r"\D+", "", text))
        except Exception:
            return 15.0
        current_year = datetime.now(timezone.utc).year
        if 1800 <= year <= current_year:
            return 90.0
        return 20.0

    if attr_key in {"revenue", "annual_revenue", "revenue_range", "employees", "employee_count", "employee_range"}:
        cleaned = re.sub(r"[\s,$€£¥]", "", text)
        if re.fullmatch(r"\d+(?:\.\d+)?(?:[kKmMbBtT])?", cleaned) or re.fullmatch(r"\d+\s*[-–]\s*\d+(?:[kKmMbBtT])?", cleaned):
            return 88.0
        return 34.0

    if attr_key in {"lei"}:
        if re.fullmatch(r"[0-9A-Z]{20}", re.sub(r"\s+", "", text).upper()):
            return 96.0
        return 25.0

    if attr_key in {"registry_number", "company_number", "cik", "sic_code", "naics_code", "ticker"}:
        if len(re.sub(r"\W+", "", text)) >= 3:
            return 82.0
        return 28.0

    if attr_key in {"postal_code", "zip", "zipcode", "postal"}:
        if re.fullmatch(r"[A-Za-z0-9\-\s]{3,10}", text):
            return 84.0
        return 26.0

    score = 76.0
    if len(text) <= 2:
        score = 38.0
    elif len(text) <= 5:
        score = 58.0
    elif len(text) <= 80:
        score = 84.0
    elif len(text) <= 140:
        score = 68.0
    else:
        score = 48.0
    if any(marker in text for marker in ("...", "…")):
        score -= 14.0
    if text.count(" ") > 16:
        score -= 8.0
    return max(0.0, min(100.0, score))


def _completeness_score(value: Any) -> float:
    if _is_blank_confidence_value(value):
        return 0.0

    text = _normalize_confidence_text(value)
    score = 100.0
    if len(text) <= 2:
        score = 35.0
    elif len(text) <= 5:
        score = 60.0
    elif len(text) <= 80:
        score = 95.0
    elif len(text) <= 140:
        score = 78.0
    else:
        score = 56.0

    placeholder_hits = sum(1 for token in ("n/a", "unknown", "pending", "not available", "todo") if token in text.lower())
    if placeholder_hits:
        score -= 25.0
    if any(marker in text for marker in ("...", "…")):
        score -= 18.0
    if text.endswith(("-", "/", ",")):
        score -= 8.0
    if text.count(" ") > 20:
        score -= 6.0
    return max(0.0, min(100.0, score))


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        try:
            raw = float(value)
            if raw > 1e12:
                raw /= 1000.0
            return datetime.fromtimestamp(raw, tz=timezone.utc)
        except Exception:
            return None
    text = _normalize_confidence_text(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _freshness_score(record: Dict[str, Any]) -> Optional[float]:
    for key in ("scraped_at", "updated_at", "timestamp", "created_at", "fetched_at", "retrieved_at", "published_at", "last_updated"):
        parsed = _parse_timestamp((record or {}).get(key))
        if parsed is None:
            continue
        now = datetime.now(timezone.utc)
        age_days = max(0.0, (now - parsed.astimezone(timezone.utc)).total_seconds() / 86400.0)
        if age_days <= 7:
            return 100.0
        if age_days <= 30:
            return 93.0
        if age_days <= 90:
            return 82.0
        if age_days <= 180:
            return 70.0
        if age_days <= 365:
            return 58.0
        if age_days <= 730:
            return 42.0
        return 26.0
    return None


def _build_confidence_evidence(attr: str, value: Any, record: Dict[str, Any], source: str, record_index: int) -> Dict[str, Any]:
    identity = _identity_score(attr, value, record, source, record_index)
    validation = _validation_score(attr, value)
    completeness = _completeness_score(value)
    freshness = _freshness_score(record)
    raw_text = _normalize_confidence_text(value)
    normalized_value = raw_text.lower()
    is_missing_value = raw_text == "" or normalized_value in {"-", "—", "–"}
    is_placeholder_value = normalized_value in {"n/a", "na", "none", "null", "unknown", "tbd", "pending", "not available"}

    def _identity_adjustment(score: float) -> float:
        if is_missing_value or is_placeholder_value:
            return 0.0
        if score >= 60:
            return 15.0
        if score >= 50:
            return 10.0
        if score >= 35:
            return 5.0
        return 0.0

    def _validation_adjustment(score: float) -> float:
        if is_missing_value or is_placeholder_value:
            return 0.0
        if score >= 90:
            return 8.0
        if score >= 70:
            return 4.0
        if score < 40:
            return -15.0
        return 0.0

    def _completeness_adjustment(score: float, raw_value: Any) -> float:
        if is_placeholder_value:
            return -15.0
        if is_missing_value:
            return -10.0
        if score >= 85:
            return 5.0
        if score >= 50:
            return 0.0
        return -10.0

    def _freshness_adjustment(score: Optional[float]) -> float:
        if score is None:
            return 0.0
        if score >= 90:
            return 2.0
        if score <= 40:
            return -3.0
        return 0.0

    def _source_bonus(attr_name: str, raw_value: Any, record_data: Dict[str, Any], source_url: str) -> float:
        value_text = _normalize_confidence_text(raw_value)
        if not value_text:
            return 0.0
        trusted_matches = 0
        compare_fields = (
            "website",
            "url",
            "domain",
            "website_url",
            "linkedin_url",
            "contact_email",
            "email",
            "phone",
        )
        normalized_attr = _normalize_coverage_key(attr_name)
        normalized_value = value_text.strip().lower()
        for key in compare_fields:
            if _normalize_coverage_key(key) == normalized_attr:
                continue
            candidate = record_data.get(key)
            if _is_blank_confidence_value(candidate):
                continue
            candidate_text = _normalize_confidence_text(candidate).strip().lower()
            if not candidate_text:
                continue
            if normalized_value == candidate_text:
                trusted_matches += 1
        if source_url and normalized_value and normalized_value in _normalize_confidence_text(source_url).lower():
            trusted_matches += 1
        if trusted_matches >= 2:
            return 3.0
        if trusted_matches == 1:
            return 1.5
        return 0.0

    score = 70.0
    score += _identity_adjustment(identity)
    score += _validation_adjustment(validation)
    score += _completeness_adjustment(completeness, value)
    score += _freshness_adjustment(freshness)
    score += _source_bonus(attr, value, record, source)
    score = max(20.0, min(99.0, round(score, 1)))

    return {
        "score": score,
        "identity_confidence": round(identity, 1),
        "attribute_validation": round(validation, 1),
        "data_completeness": round(completeness, 1),
        "freshness": round(freshness, 1) if freshness is not None else None,
        "confidence_adjustments": {
            "base_confidence": 70.0,
            "identity_adjustment": round(_identity_adjustment(identity), 1),
            "validation_adjustment": round(_validation_adjustment(validation), 1),
            "completeness_adjustment": round(_completeness_adjustment(completeness, value), 1),
            "freshness_adjustment": round(_freshness_adjustment(freshness), 1),
            "source_bonus": round(_source_bonus(attr, value, record, source), 1),
        },
    }


def _is_blank_coverage_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        try:
            return float(value) != float(value)
        except Exception:
            return False
    text = str(value).strip()
    return text.lower() in _COVERAGE_BLANK_SENTINELS


def _normalize_coverage_key(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "_").replace("-", "_")


def _load_json_records(path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            loaded = json.load(f)
        return loaded if isinstance(loaded, list) else []
    except Exception:
        return []


def _parse_filters(filters_str: Optional[str]) -> Dict[str, Any]:
    if not filters_str:
        return {}
    try:
        parsed = json.loads(filters_str)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _derive_expected_attributes(records: List[Dict[str, Any]], config: Dict[str, Any]) -> List[str]:
    selected_outputs = config.get("selectedOutputs") or config.get("selected_outputs") or config.get("outputs") or []
    attrs = [str(attr).strip() for attr in selected_outputs if str(attr).strip()]
    if attrs:
        return attrs

    discovered: List[str] = []
    seen = set()
    for record in records:
        if not isinstance(record, dict):
            continue
        for key in record.keys():
            normalized = _normalize_coverage_key(key)
            if not normalized or normalized in _COVERAGE_META_KEYS or normalized in seen:
                continue
            seen.add(normalized)
            discovered.append(str(key))
    return discovered


def _extract_coverage_weights(config: Dict[str, Any], attributes: List[str]) -> Dict[str, float]:
    raw_weights = (
        config.get("coverageWeights")
        or config.get("coverage_weights")
        or config.get("attributeWeights")
        or config.get("attribute_weights")
        or config.get("weights")
        or {}
    )
    if not isinstance(raw_weights, dict):
        return {}

    normalized_weights: Dict[str, float] = {}
    for key, value in raw_weights.items():
        try:
            weight = float(value)
        except Exception:
            continue
        if weight <= 0:
            continue
        normalized_weights[_normalize_coverage_key(key)] = weight

    resolved: Dict[str, float] = {}
    for attr in attributes:
        weight = normalized_weights.get(_normalize_coverage_key(attr))
        if weight is not None:
            resolved[attr] = weight
    return resolved


def _derive_selected_sources(config: Dict[str, Any]) -> List[str]:
    raw_sources = (
        config.get("pickedSources")
        or config.get("selectedSources")
        or config.get("selected_sources")
        or config.get("sources")
        or []
    )
    if not isinstance(raw_sources, list):
        return []
    selected = [str(source).strip() for source in raw_sources if str(source).strip()]
    deduped: List[str] = []
    seen = set()
    for source in selected:
        key = _normalize_coverage_key(source)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(source)
    return deduped


def _source_signal_fields(source_name: str) -> List[str]:
    normalized = _normalize_coverage_key(source_name)
    if "website" in normalized:
        return ["website", "website_url", "url", "domain", "corp_site", "websiteurl"]
    if "linkedin" in normalized:
        return ["linkedin_url", "linkedin", "contact_linkedin", "ceo_linkedin"]
    if "crunchbase" in normalized:
        return ["funding_total", "latest_round", "latest_round_amount", "valuation", "investors", "annual_revenue", "revenue_range"]
    if "sec" in normalized or "edgar" in normalized:
        return ["cik", "ticker", "sic_code", "filings", "sec_company_name", "sec_entity_type", "registry_number"]
    if "mca" in normalized:
        return ["cin", "company_number", "registered_office_address", "incorporation_state", "registry_number"]
    if "companies_house" in normalized or "companieshouse" in normalized:
        return ["company_number", "registry_number", "incorporation_date", "registered_address", "filings"]
    if "gleif" in normalized or "lei" in normalized:
        return ["lei", "legal_entity_identifier", "registry_number", "entity_status"]
    if "wikidata" in normalized:
        return ["wikidata_id", "qid", "wikipedia_url", "registry_number"]
    return []


def _build_source_breakdown(
    *,
    selected_sources: List[str],
    input_records: List[Dict[str, Any]],
    run_records: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    records_requested = len(input_records) if input_records else len(run_records)
    breakdown: List[Dict[str, Any]] = []

    for source_name in selected_sources:
        signal_fields = _source_signal_fields(source_name)
        field_counter: Counter[str] = Counter()
        returned_rows = 0

        for record in run_records:
            if not isinstance(record, dict):
                continue
            filled_fields = [
                field
                for field in signal_fields
                if not _is_blank_coverage_value(record.get(field))
            ]
            if filled_fields:
                returned_rows += 1
                field_counter.update(filled_fields)

        if not signal_fields:
            # Best-effort fallback: if we cannot map the source, use whether the row produced any non-meta fields.
            for record in run_records:
                if not isinstance(record, dict):
                    continue
                visible_fields = [
                    key
                    for key in record.keys()
                    if _normalize_coverage_key(key) not in _COVERAGE_META_KEYS and not _is_blank_coverage_value(record.get(key))
                ]
                if visible_fields:
                    returned_rows += 1
                    field_counter.update(visible_fields)

        source_coverage = (
            returned_rows / float(records_requested)
            if records_requested > 0
            else None
        )
        top_fields = [
            {"attribute_key": field, "filled_records": count}
            for field, count in field_counter.most_common(5)
        ]

        breakdown.append(
            {
                "source_key": _normalize_coverage_key(source_name),
                "source_label": source_name,
                "records_requested_from_source": records_requested,
                "records_returned_by_source": returned_rows,
                "source_coverage": source_coverage,
                "filled_attributes": sum(field_counter.values()),
                "filled_fields": top_fields,
            }
        )

    return breakdown


def build_review_coverage(
    job_id: str,
    *,
    source: Optional[str] = None,
    mode: Optional[str] = None,
    scope: Optional[str] = None,
    filters_str: Optional[str] = None,
    refresh_count: Optional[int] = None,
) -> Dict[str, Any]:
    from app.api.demo_routes import _latest_run_number_for_job
    from app.services.admin_request_audit_service import admin_request_audit_service

    config = _parse_filters(filters_str)
    selected_sources = _derive_selected_sources(config)
    if not selected_sources and source:
        selected_sources = [str(source).strip()]
    job_mode = str(mode or "").strip()
    current_run_num = _latest_run_number_for_job(job_id, int(refresh_count or 0))
    if current_run_num <= 0:
        current_run_num = 1

    decisions_dir = os.path.join(BASE_DIR, "datasets")
    input_records = _load_json_records(os.path.join(decisions_dir, f"{job_id}_input.json"))
    run_records = _load_json_records(os.path.join(decisions_dir, f"{job_id}_run_{current_run_num}.json"))
    if not run_records and current_run_num == 1:
        run_records = _load_json_records(os.path.join(decisions_dir, f"{job_id}_run_1.json"))

    execution_metadata: Dict[str, Any] = {}
    try:
        audit = admin_request_audit_service.get_by_job_id(job_id)
        if audit and isinstance(audit.get("execution_metadata"), dict):
            execution_metadata = dict(audit["execution_metadata"])
    except Exception:
        execution_metadata = {}

    records_in_scope = len(run_records)
    expected_attributes = _derive_expected_attributes(run_records or input_records, config)
    attr_weights = _extract_coverage_weights(config, expected_attributes)

    attribute_breakdown: List[Dict[str, Any]] = []
    record_breakdown: List[Dict[str, Any]] = []
    total_filled_cells = 0
    total_record_coverage = 0.0
    weighted_filled_cells = 0.0
    total_weight = sum(attr_weights.get(attr, 0.0) for attr in expected_attributes)

    if records_in_scope > 0 and expected_attributes:
        for record_index, record in enumerate(run_records):
            if not isinstance(record, dict):
                continue
            filled_count = 0
            filled_fields: List[str] = []
            missing_fields: List[str] = []
            for attr in expected_attributes:
                raw_value = record.get(attr)
                is_filled = not _is_blank_coverage_value(raw_value)
                if is_filled:
                    filled_count += 1
                    filled_fields.append(attr)
                    total_filled_cells += 1
                    weighted_filled_cells += attr_weights.get(attr, 0.0)
                else:
                    missing_fields.append(attr)
            record_coverage_value = filled_count / len(expected_attributes)
            total_record_coverage += record_coverage_value
            record_breakdown.append(
                {
                    "record_index": record_index,
                    "record_label": f"Record {record_index + 1}",
                    "filled_attributes": filled_count,
                    "expected_attributes": len(expected_attributes),
                    "record_coverage": record_coverage_value,
                    "filled_fields": filled_fields,
                    "missing_fields": missing_fields,
                }
            )

        for attr in expected_attributes:
            non_null_values = sum(
                1
                for record in run_records
                if isinstance(record, dict) and not _is_blank_coverage_value(record.get(attr))
            )
            item: Dict[str, Any] = {
                "attribute_key": attr,
                "attribute_label": attr.replace("_", " ").title(),
                "non_null_values": non_null_values,
                "total_records_in_scope": records_in_scope,
                "attr_coverage": non_null_values / records_in_scope if records_in_scope else None,
            }
            if attr in attr_weights:
                item["weight"] = attr_weights[attr]
            attribute_breakdown.append(item)

    source_breakdown = _build_source_breakdown(
        selected_sources=selected_sources,
        input_records=input_records,
        run_records=run_records,
    )

    job_coverage = (
        total_filled_cells / float(records_in_scope * len(expected_attributes))
        if records_in_scope > 0 and expected_attributes
        else None
    )
    record_coverage = (
        total_record_coverage / records_in_scope
        if records_in_scope > 0 and expected_attributes
        else None
    )

    weighted_job_coverage = None
    if records_in_scope > 0 and expected_attributes and total_weight > 0:
        weighted_job_coverage = weighted_filled_cells / float(records_in_scope * total_weight)

    source_requested = None
    source_returned = None
    if job_mode in ("By Dataset", "Any-Site"):
        if input_records and run_records:
            source_requested = len(input_records)
            source_returned = len(run_records)
    else:
        for key in ("records_requested", "requested_records", "total_matched_records"):
            value = execution_metadata.get(key)
            if isinstance(value, (int, float)) and value > 0:
                source_requested = int(value)
                break
        for key in ("records_returned", "returned_records", "records_count", "records"):
            value = execution_metadata.get(key)
            if isinstance(value, (int, float)) and value >= 0:
                source_returned = int(value)
                break
        if source_requested is None and source_returned is not None and source_returned > 0:
            if execution_metadata.get("is_truncated") is False:
                source_requested = source_returned

    source_coverage = (
        source_returned / float(source_requested)
        if source_requested and source_returned is not None and source_requested > 0
        else None
    )

    return {
        "job_coverage": job_coverage,
        "source_coverage": source_coverage,
        "record_coverage": record_coverage,
        "weighted_job_coverage": weighted_job_coverage,
        "records_in_scope": records_in_scope,
        "expected_attributes": len(expected_attributes) if expected_attributes else None,
        "total_filled_cells": total_filled_cells if records_in_scope > 0 and expected_attributes else None,
        "source_requested": source_requested,
        "source_returned": source_returned,
        "attribute_breakdown": attribute_breakdown,
        "record_breakdown": record_breakdown,
        "source_breakdown": source_breakdown,
        "weights_applied": bool(attr_weights),
        "source_kind": execution_metadata.get("source_kind"),
    }

def _normalize_dataset_review_row(
    record: Dict[str, Any],
    selected_outputs: List[str],
    attr_mapping: Dict[str, str],
) -> Dict[str, Any]:
    """Project a raw uploaded row into the canonical fields the Review grid expects."""
    aliases = {
        "company_name": ("company_name", "company", "name", "organization", "legal_name"),
        "legal_name": ("company_name", "company", "name", "organization", "legal_name"),
        "website": ("website", "url", "domain", "website_url", "corp_site", "websiteUrl"),
        "email": ("email", "email_address", "work_email", "business_email", "contact_email"),
        "phone": ("phone", "phone_number", "telephone", "mobile"),
        "linkedin_url": ("linkedin_url", "linkedin", "linkedin_profile"),
        "description": ("description", "overview", "about", "summary"),
        "industry": ("industry", "linkedIn industry", "linkedin industry", "linkedIn_industry"),
        "sub_industry": ("sub_industry", "sub industry", "sub-industry"),
        "founded_year": ("founded_year", "year_founded", "foundation_year", "founding_year"),
        "year_founded": ("founded_year", "year_founded", "foundation_year", "founding_year"),
        "sic_code": ("sic_code", "sic code", "sic"),
        "naics_code": ("naics_code", "naics code", "naics"),
        "revenue": ("revenue", "annual_revenue", "annual revenue", "revenue_range"),
        "annual_revenue": ("annual_revenue", "annual revenue", "revenue"),
        "net_income": ("net_income", "profit", "income"),
        "assets": ("assets", "total_assets"),
        "liabilities": ("liabilities", "total_liabilities"),
        "hq_address": ("hq_address", "address-line 1", "address line 1", "address", "street"),
        "hq_city": ("hq_city", "city"),
        "hq_state": ("hq_state", "state"),
        "hq_country": ("hq_country", "country"),
        "registry_number": ("registry_number", "cik", "cik_number", "company_number"),
        "ticker": ("ticker", "symbol"),
        "employees": ("employees", "employee_count", "headcount"),
        "employee_count": ("employee_count", "employees", "headcount"),
        "employee_range": ("employee_range", "employee range", "headcount_range"),
        "company_type": ("company_type", "legal_form", "ownership"),
        "ownership": ("ownership", "company_type", "legal_form"),
        "last_round": ("last_round", "latest_round"),
        "latest_round": ("latest_round", "last_round"),
        "amount_raised": ("amount_raised", "latest_round_amount", "funding_total"),
        "latest_round_amount": ("latest_round_amount", "amount_raised", "funding_total"),
        "valuation": ("valuation", "post_money_valuation"),
        "investors": ("investors", "backers"),
        "cms": ("cms", "content_management_system"),
        "analytics": ("analytics", "analytics_stack"),
        "frameworks": ("frameworks", "js_frameworks"),
        "hosting": ("hosting", "hosting_provider"),
        "tech_stack": ("tech_stack", "technology_stack"),
        "contact_name": ("contact_name", "full_name", "person_name"),
        "contact_title": ("contact_title", "title", "job_title"),
        "contact_seniority": ("contact_seniority", "seniority"),
        "ceo_name": ("ceo_name", "chief_executive_officer"),
        "cfo_name": ("cfo_name",),
        "cto_name": ("cto_name",),
        "executives": ("executives", "leadership_team"),
        "board_members": ("board_members", "board"),
        "lei": ("lei", "lei_code"),
        "tax_id": ("tax_id", "ein", "vat_number"),
        "incorporation_state": ("incorporation_state", "state_of_incorporation"),
        "twitter_handle": ("twitter_handle", "twitter_url", "x_url"),
        "facebook_url": ("facebook_url",),
    }

    canonical_fields = selected_outputs or list(record.keys())
    normalized: Dict[str, Any] = {}
    for attr in canonical_fields:
        canonical = _normalize_field_key(attr)
        source_field = attr_mapping.get(canonical) or attr_mapping.get(attr) or ""
        value = _pick_original_value(record, source_field) if source_field else None
        if value in (None, "", [], {}):
            value = _pick_original_value(record, *aliases.get(canonical, (canonical,)))
        normalized[canonical] = value
    return normalized

def get_deterministic_confidence(attr: str, prev_val: str, new_val: str, record_index: int) -> Optional[float]:
    evidence = _build_confidence_evidence(attr, new_val, {}, "", record_index)
    return round(evidence["score"] / 100.0, 3)
    if prev_val == "—" and new_val == "—":
        return None
    if prev_val != "—" and new_val == "—":
        return None
    if prev_val == "—" and new_val != "—":
        return round(_build_confidence_evidence(attr, new_val, {}, "", record_index)["score"] / 100.0, 3)
    if prev_val.lower().strip() == new_val.lower().strip():
        return round(_build_confidence_evidence(attr, new_val, {}, "", record_index)["score"] / 100.0, 3)
    
    source_confidence = 85
    if attr == "website":
        source_confidence = 98
    elif attr in ("phone", "email"):
        source_confidence = 95
    elif attr in ("legal_name", "description"):
        source_confidence = 70
        
    validation_bonus = 2
    ambiguity_penalty = 0
    if len(new_val) > 30:
        ambiguity_penalty = 5
    score = source_confidence + validation_bonus - ambiguity_penalty
    return min(0.99, max(0.60, score / 100))


def get_evidence_based_confidence(
    attr: str,
    new_val: Any,
    record_index: int,
    record: Optional[Dict[str, Any]] = None,
    source: str = "",
) -> float:
    evidence = _build_confidence_evidence(attr, new_val, record or {}, source, record_index)
    return round(evidence["score"] / 100.0, 3)


def compare_records(
    source: str,
    baseline_records: List[Dict[str, Any]],
    new_records: List[Dict[str, Any]],
    is_dataset: bool = False,
    allowed_attrs: Optional[List[str]] = None,
    attr_mapping: Optional[Dict[str, str]] = None,
    record_offset: int = 0,
    scope: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    from app.api.demo_routes import get_record_key

    baseline_map = {}
    for idx, r in enumerate(baseline_records):
        if is_dataset:
            key = f"idx_{idx}"
        else:
            key = get_record_key(source, r)
            if not key or key.strip() == "":
                key = f"idx_{idx}"
        orig_key = key
        counter = 1
        while key in baseline_map:
            key = f"{orig_key}_{counter}"
            counter += 1
        baseline_map[key] = (r, idx)

    new_map = {}
    for idx, r in enumerate(new_records):
        if is_dataset:
            key = f"idx_{idx}"
        else:
            key = get_record_key(source, r)
            if not key or key.strip() == "":
                key = f"idx_{idx}"
        orig_key = key
        counter = 1
        while key in new_map:
            key = f"{orig_key}_{counter}"
            counter += 1
        new_map[key] = (r, idx)

    ordered_keys = []
    for k in new_map.keys():
        ordered_keys.append(k)
    for k in baseline_map.keys():
        if k not in new_map:
            ordered_keys.append(k)

    exclude_keys = {"id", "run_id", "timestamp", "scraped_at", "created_at"}
    if allowed_attrs:
        attrs = [a for a in allowed_attrs if a not in exclude_keys]
    else:
        all_attrs = set()
        for r, _ in new_map.values():
            all_attrs.update(r.keys())
        for r, _ in baseline_map.values():
            all_attrs.update(r.keys())
        attrs = sorted([a for a in all_attrs if a not in exclude_keys])

    def clean_value(v):
        if v is None:
            return ""
        s = str(v).strip()
        if s.lower() in ("", "-", "—", "–", "null", "n/a", "na", "none", "nan", "unknown"):
            return ""
        return s

    flattened_rows = []
    record_change_count = 0

    for idx, k in enumerate(ordered_keys):
        new_val_exists = k in new_map
        baseline_val_exists = k in baseline_map

        rec = new_map[k][0] if new_val_exists else baseline_map[k][0]
        found_website = find_company_website(rec) or source
        source_lower = str(source or "").strip().lower()
        # Prefer a record-level detail URL (specific page) over the root domain
        _detail_url_fields = ("detail_url", "listing_url", "source_url", "profile_url", "page_url", "url", "link", "href", "page", "product_url", "item_url")
        _record_url = next((str(rec.get(f, "")).strip() for f in _detail_url_fields if rec.get(f) and str(rec.get(f, "")).startswith("http")), None)
        scope_url = str(scope or "").strip() if scope and str(scope or "").strip().startswith("http") else None
        if "keysight" in source_lower:
            source_url = _record_url or scope_url or "https://www.keysight.com"
            source_display = clean_domain(source_url) if (_record_url or scope_url) else "keysight.com"
        else:
            root_url = found_website if found_website.startswith("http") else f"https://{found_website}"
            source_url = _record_url or scope_url or root_url
            source_display = clean_domain(source_url)

        record_has_changes = False

        for attr in attrs:
            prev = "—"
            new_val = "—"
            change_type = "V"

            if new_val_exists and baseline_val_exists:
                if is_dataset:
                    prev_raw = baseline_map[k][0].get(attr)
                    new_raw = new_map[k][0].get(attr)
                else:
                    baseline_key = attr_mapping.get(attr) if attr_mapping else attr
                    prev_raw = baseline_map[k][0].get(baseline_key) if baseline_key else baseline_map[k][0].get(attr)
                    new_raw = new_map[k][0].get(attr)
                prev = str(prev_raw) if prev_raw is not None else "—"
                new_val = str(new_raw) if new_raw is not None else "—"
                
                p_clean = clean_value(prev)
                n_clean = clean_value(new_val)
                
                if p_clean == "" and n_clean == "":
                    change_type = "V"
                elif p_clean == "" and n_clean != "":
                    change_type = "A"
                elif p_clean != "" and n_clean == "":
                    change_type = "D"
                elif p_clean.lower() == n_clean.lower():
                    change_type = "V"
                else:
                    change_type = "M"

            elif new_val_exists:
                new_raw = new_map[k][0].get(attr)
                new_val = str(new_raw) if new_raw is not None else "—"
                if clean_value(new_val) != "":
                    change_type = "A"
                else:
                    change_type = "V"

            else: # baseline_val_exists but deleted in new
                if is_dataset:
                    prev_raw = baseline_map[k][0].get(attr)
                else:
                    baseline_key = attr_mapping.get(attr) if attr_mapping else attr
                    prev_raw = baseline_map[k][0].get(baseline_key) if baseline_key else baseline_map[k][0].get(attr)
                prev = str(prev_raw) if prev_raw is not None else "—"
                if clean_value(prev) != "":
                    change_type = "D"
                else:
                    change_type = "V"

            if change_type in ("A", "M", "D"):
                record_has_changes = True

            conf = get_evidence_based_confidence(attr, new_val, idx, rec, source_url)
            attr_label = attr.replace("_", " ").title()

            flattened_rows.append({
                "id": f"{k}-{attr}",
                "record": f"Record {record_offset + idx + 1}",
                "attribute": attr_label,
                "attributeKey": attr,
                "recordIndex": idx,
                "previous": prev,
                "value": new_val,
                "changeType": change_type,
                "changed": change_type != "V",
                "conf": conf,
                "sourceUrl": source_url,
                "source": source_display,
                "recordKey": k
            })

        if record_has_changes:
            record_change_count += 1

    return flattened_rows, record_change_count

def get_review_rows(job_id: str, sample_rate: float, sample_offset: int = 0, include_coverage: bool = False) -> dict:
    from app.core.database import get_connection
    from app.api.demo_routes import _latest_run_number_for_job

    with get_connection() as conn:
        row = conn.execute("SELECT refresh_count, source, scope, mode, filters, frequency FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
    
    if not row:
        return {
            "rows": [],
            "totalSampled": 0,
            "sampledCount": 0,
            "coverage": compact_review_coverage(build_review_coverage(job_id)) if include_coverage else None,
        }

    refresh_count, source, scope, mode, filters_str = row[0], row[1], row[2], row[3], row[4]
    frequency = row[5] if len(row) > 5 else None
    freq_clean = str(frequency or "").strip().lower()
    is_one_time = (
        job_id in ("J-1782991245770", "J-1783492606683")
        or freq_clean in ("one-time", "one time", "once", "single", "single run")
    )
    is_dataset = mode in ("By Dataset", "Any-Site")
    baseline_records = []

    selected_outputs: List[str] = []
    attr_mapping: Dict[str, str] = {}
    if filters_str and filters_str not in ("â€”", "—"):
        try:
            config = json.loads(filters_str)
            if isinstance(config, dict):
                selected_outputs = [str(a) for a in (config.get("selectedOutputs") or []) if str(a).strip()]
                raw_mapping = config.get("mapping") or {}
                if isinstance(raw_mapping, dict):
                    attr_mapping = {str(k): str(v) for k, v in raw_mapping.items() if str(k).strip() and str(v).strip()}
        except Exception:
            pass

    cache_signature_parts: List[str] = [
        "review_logic_v6",
        f"refresh_count={refresh_count}",
        f"source={source or ''}",
        f"scope={scope or ''}",
        f"mode={mode or ''}",
        f"filters={filters_str or ''}",
        f"sample_rate={float(sample_rate):.4f}",
        f"sample_offset={int(sample_offset)}",
        f"coverage={1 if include_coverage else 0}",
    ]

    # 1. Load latest scraped dataset
    if is_dataset:
        current_run_num = _latest_run_number_for_job(job_id, refresh_count)
        if current_run_num <= 0:
            current_run_num = 1

        def load_json_records(path: str) -> List[Dict[str, Any]]:
            if not os.path.exists(path):
                return []
            try:
                with open(path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                return loaded if isinstance(loaded, list) else []
            except Exception:
                return []

        input_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_input.json")
        final_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_final.json")
        current_run_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_run_{current_run_num}.json")
        previous_run_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_run_{current_run_num - 1}.json") if current_run_num > 1 else ""
        cache_signature_parts.extend([
            f"run_num={current_run_num}",
            f"input={_file_signature(input_path)}",
            f"final={_file_signature(final_path)}",
            f"current_run={_file_signature(current_run_path)}",
            f"previous_run={_file_signature(previous_run_path) if previous_run_path else 'missing'}",
        ])
        cache_key = _review_cache_key(job_id, sample_rate, cache_signature_parts)
        cache_path = _REVIEW_CACHE_DIR / f"{cache_key}.json"
        cached_payload = _read_review_cache(cache_path, cache_key)
        if cached_payload is not None:
            return cached_payload

        input_rows = load_json_records(input_path)
        run_rows = load_json_records(current_run_path)
        if not run_rows and current_run_num == 1:
            run_rows = load_json_records(os.path.join(BASE_DIR, "datasets", f"{job_id}_run_1.json"))

        baseline_source_rows = []
        if current_run_num > 1:
            baseline_source_rows = load_json_records(os.path.join(BASE_DIR, "datasets", f"{job_id}_run_{current_run_num - 1}.json"))
        if not baseline_source_rows:
            baseline_source_rows = load_json_records(final_path)
        if not baseline_source_rows:
            baseline_source_rows = input_rows

        baseline_records = [
            _normalize_dataset_review_row(row, selected_outputs, attr_mapping)
            for row in baseline_source_rows
            if isinstance(row, dict)
        ]
        if not run_rows:
            return {
                "rows": [],
                "totalSampled": len(baseline_source_rows),
                "sampledCount": 0,
                "coverage": compact_review_coverage(build_review_coverage(
                    job_id,
                    source=source,
                    mode=mode,
                    scope=scope,
                    filters_str=filters_str,
                    refresh_count=refresh_count,
                )) if include_coverage else None,
            }
        new_records = [
            _normalize_dataset_review_row(row, selected_outputs, attr_mapping)
            for row in run_rows
            if isinstance(row, dict)
        ]
    else:
        current_run_num = _latest_run_number_for_job(job_id, refresh_count)
        if current_run_num <= 0:
            current_run_num = 1

        run_file_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_run_{current_run_num}.json")
        baseline_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_final.json")
        previous_run_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_run_{current_run_num - 1}.json") if current_run_num > 1 else ""
        cache_signature_parts.extend([
            f"run_num={current_run_num}",
            f"run_file={_file_signature(run_file_path)}",
            f"baseline={_file_signature(baseline_path)}",
            f"previous_run={_file_signature(previous_run_path) if previous_run_path else 'missing'}",
        ])
        cache_key = _review_cache_key(job_id, sample_rate, cache_signature_parts)
        cache_path = _REVIEW_CACHE_DIR / f"{cache_key}.json"
        cached_payload = _read_review_cache(cache_path, cache_key)
        if cached_payload is not None:
            return cached_payload

        new_records = []
        if os.path.exists(run_file_path):
            try:
                with open(run_file_path, "r", encoding="utf-8") as f:
                    new_records = json.load(f)
            except Exception:
                pass

    # 2. Load baseline approved dataset
    if not is_dataset:
        baseline_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_final.json")
        if os.path.exists(baseline_path):
            baseline_records = _load_json_records(baseline_path)
        if not baseline_records and current_run_num > 1:
            previous_run_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_run_{current_run_num - 1}.json")
            baseline_records = _load_json_records(previous_run_path)

    total_records = len(new_records)
    attr_count_hint = 0
    preview_rows = []
    preview_rows.extend(new_records[:20])
    preview_rows.extend(baseline_records[:20])
    preview_keys = set()
    for row in preview_rows:
        if isinstance(row, dict):
            preview_keys.update(
                k for k in row.keys()
                if k not in {"id", "run_id", "timestamp", "scraped_at", "created_at"}
            )
    attr_count_hint = max(len(preview_keys), 1)
    sample_offset = max(0, int(sample_offset))
    target_records = max(1, int(round(total_records * float(sample_rate) / 100.0)))
    # Keep very large review payloads responsive in the browser.
    max_flattened_rows = 600
    max_records_by_shape = max(1, max_flattened_rows // attr_count_hint)
    sample_limit = min(target_records, max_records_by_shape, 100)
    # Keep the visible review payload bounded by both the requested sample and record shape complexity.
    sampled_new = new_records[sample_offset:sample_offset + sample_limit]
    sampled_baseline = baseline_records[sample_offset:sample_offset + sample_limit]

    # Perform comparison
    rows, _ = compare_records(
        source,
        sampled_baseline,
        sampled_new,
        is_dataset=is_dataset,
        allowed_attrs=selected_outputs if selected_outputs else None,
        attr_mapping=attr_mapping if attr_mapping else None,
        record_offset=sample_offset,
        scope=scope,
    )

    if is_one_time and not is_dataset and rows:
        for r in rows:
            r["previous"] = "-"
            r["changeType"] = "V"
            r["changed"] = False

    result = {
        "rows": rows,
        "totalSampled": total_records,
        "sampledCount": len(sampled_new),
        "coverage": compact_review_coverage(build_review_coverage(
            job_id,
            source=source,
            mode=mode,
            scope=scope,
            filters_str=filters_str,
            refresh_count=refresh_count,
        )) if include_coverage else None,
    }
    _write_review_cache(cache_path, cache_key, result)
    return result


def get_job_review_summary(job_id: str) -> dict:
    from app.services.wcm_comparison_service import get_review_rows
    import os
    import json

    decisions_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_review_decisions.json")
    decisions = []
    if os.path.exists(decisions_path):
        try:
            with open(decisions_path, "r", encoding="utf-8") as f:
                decisions = json.load(f)
        except Exception:
            pass

    dec_map = {}
    for d in decisions:
        if isinstance(d, dict):
            dec_map[(d.get("record_index"), d.get("attribute"))] = d.get("reviewer_action")

    res = get_review_rows(job_id, 100.0, include_coverage=True)
    rows = res.get("rows") or []
    coverage = res.get("coverage")

    overall_approved = 0
    overall_rejected = 0

    source_buckets = {}
    attr_buckets = {}

    for r in rows:
        idx = r.get("recordIndex")
        attr_key = r.get("attributeKey")
        
        if (idx, attr_key) not in dec_map:
            continue

        action = dec_map[(idx, attr_key)]
        is_approved = (action == "accepted")
        is_rejected = (action == "rejected")

        if is_approved:
            overall_approved += 1
        elif is_rejected:
            overall_rejected += 1

        src_name = r.get("source") or "Unknown"
        if src_name not in source_buckets:
            source_buckets[src_name] = {"key": src_name, "label": src_name, "reviewed": 0, "approved": 0, "rejected": 0}
        source_buckets[src_name]["reviewed"] += 1
        if is_approved:
            source_buckets[src_name]["approved"] += 1
        elif is_rejected:
            source_buckets[src_name]["rejected"] += 1

        attr_label = r.get("attribute") or "Unknown"
        if attr_label not in attr_buckets:
            attr_buckets[attr_label] = {"key": attr_key, "label": attr_label, "reviewed": 0, "approved": 0, "rejected": 0}
        attr_buckets[attr_label]["reviewed"] += 1
        if is_approved:
            attr_buckets[attr_label]["approved"] += 1
        elif is_rejected:
            attr_buckets[attr_label]["rejected"] += 1

    source_breakdown = []
    cov_sources = {s.get("source_name"): s for s in (coverage.get("source_breakdown") or []) if s.get("source_name")} if coverage else {}
    for name, b in source_buckets.items():
        cov_val = cov_sources.get(name, {}).get("source_coverage") if name in cov_sources else None
        accuracy = (b["approved"] / b["reviewed"]) if b["reviewed"] > 0 else 0.0
        source_breakdown.append({
            "key": b["key"],
            "label": b["label"],
            "reviewed": b["reviewed"],
            "approved": b["approved"],
            "rejected": b["rejected"],
            "coverage": cov_val,
            "accuracy": accuracy
        })

    attribute_breakdown = []
    cov_attrs = {a.get("attribute_name"): a for a in (coverage.get("attribute_breakdown") or []) if a.get("attribute_name")} if coverage else {}
    for label, b in attr_buckets.items():
        cov_val = None
        for k_name, a_info in cov_attrs.items():
            if k_name.lower().replace("_", " ") == label.lower().replace("_", " "):
                cov_val = a_info.get("attr_coverage")
                break
        accuracy = (b["approved"] / b["reviewed"]) if b["reviewed"] > 0 else 0.0
        attribute_breakdown.append({
            "key": b["key"],
            "label": b["label"],
            "reviewed": b["reviewed"],
            "approved": b["approved"],
            "rejected": b["rejected"],
            "coverage": cov_val,
            "accuracy": accuracy
        })

    def get_accuracy(appr, rej):
        total = appr + rej
        if total == 0:
            return 1.0
        return appr / total

    return {
        "updatedAt": datetime.now().isoformat() + "Z",
        "overall": {
            "reviewed": overall_approved + overall_rejected,
            "approved": overall_approved,
            "rejected": overall_rejected,
            "accuracy": get_accuracy(overall_approved, overall_rejected)
        },
        "sourceBreakdown": source_breakdown,
        "attributeBreakdown": attribute_breakdown
    }
