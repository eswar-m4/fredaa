import os
import json
from typing import List, Dict, Any, Tuple, Optional
from app.config import settings

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

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

def _normalize_dataset_review_row(
    record: Dict[str, Any],
    selected_outputs: List[str],
    attr_mapping: Dict[str, str],
) -> Dict[str, Any]:
    """Project a raw uploaded row into the canonical fields the Review grid expects."""
    aliases = {
        "legal_name": ("company_name", "company", "name", "organization", "legal_name"),
        "website": ("website", "url", "domain", "website_url", "corp_site", "websiteUrl"),
        "email": ("email", "email_address", "work_email", "business_email", "contact_email"),
        "phone": ("phone", "phone_number", "telephone", "mobile"),
        "linkedin_url": ("linkedin_url", "linkedin", "linkedin_profile"),
        "description": ("description", "overview", "about", "summary"),
        "industry": ("industry", "linkedIn industry", "linkedin industry", "linkedIn_industry"),
        "sub_industry": ("sub_industry", "sub industry", "sub-industry"),
        "sic_code": ("sic_code", "sic code", "sic"),
        "naics_code": ("naics_code", "naics code", "naics"),
        "annual_revenue": ("annual_revenue", "annual revenue", "revenue"),
        "hq_address": ("hq_address", "address-line 1", "address line 1", "address", "street"),
        "hq_city": ("hq_city", "city"),
        "hq_state": ("hq_state", "state"),
        "hq_country": ("hq_country", "country"),
        "registry_number": ("registry_number", "cik", "cik_number", "company_number"),
        "ticker": ("ticker", "symbol"),
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
    if prev_val == "—" and new_val == "—":
        return None
    if prev_val != "—" and new_val == "—":
        return None
    if prev_val == "—" and new_val != "—":
        return 0.95
    if prev_val.lower().strip() == new_val.lower().strip():
        return 1.0
    
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

def compare_records(source: str, baseline_records: List[Dict[str, Any]], new_records: List[Dict[str, Any]], is_dataset: bool = False, allowed_attrs: Optional[List[str]] = None, attr_mapping: Optional[Dict[str, str]] = None) -> Tuple[List[Dict[str, Any]], int]:
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
        if s in ("", "-", "—"):
            return ""
        return s

    flattened_rows = []
    record_change_count = 0

    for idx, k in enumerate(ordered_keys):
        new_val_exists = k in new_map
        baseline_val_exists = k in baseline_map

        rec = new_map[k][0] if new_val_exists else baseline_map[k][0]
        found_website = find_company_website(rec) or source
        source_url = found_website if found_website.startswith("http") else f"https://{found_website}"
        source_display = clean_domain(found_website)

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

            conf = get_deterministic_confidence(attr, prev, new_val, idx)
            attr_label = attr.replace("_", " ").title()

            flattened_rows.append({
                "id": f"{k}-{attr}",
                "record": f"Record {idx + 1}",
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

def get_review_rows(job_id: str, sample_rate: float) -> dict:
    from app.core.database import get_connection

    with get_connection() as conn:
        row = conn.execute("SELECT refresh_count, source, scope, mode, filters FROM scraper_jobs WHERE id = ?", (job_id,)).fetchone()
    
    if not row:
        return {"rows": [], "totalSampled": 0, "sampledCount": 0}

    refresh_count, source, scope, mode, filters_str = row
    is_dataset = mode in ("By Dataset", "Any-Site")

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
    
    # 1. Load latest scraped dataset
    if is_dataset:
        input_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_input.json")
        run_file_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_run_1.json")

        input_rows = []
        if os.path.exists(input_path):
            try:
                with open(input_path, "r", encoding="utf-8") as f:
                    input_rows = json.load(f)
            except Exception:
                pass

        run_rows = []
        if os.path.exists(run_file_path):
            try:
                with open(run_file_path, "r", encoding="utf-8") as f:
                    run_rows = json.load(f)
            except Exception:
                pass

        baseline_records = [
            _normalize_dataset_review_row(row, selected_outputs, attr_mapping)
            for row in input_rows
            if isinstance(row, dict)
        ]
        if not run_rows:
            return {"rows": [], "totalSampled": len(input_rows), "sampledCount": 0}
        new_records = [
            _normalize_dataset_review_row(row, selected_outputs, attr_mapping)
            for row in run_rows
            if isinstance(row, dict)
        ]
    else:
        run_file_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_run_{refresh_count + 1}.json")
        new_records = []
        if os.path.exists(run_file_path):
            try:
                with open(run_file_path, "r", encoding="utf-8") as f:
                    new_records = json.load(f)
            except Exception:
                pass

    # 2. Load baseline approved dataset
    if not is_dataset:
        if refresh_count > 0:
            baseline_path = os.path.join(BASE_DIR, "datasets", f"{job_id}_final.json")
            if os.path.exists(baseline_path):
                try:
                    with open(baseline_path, "r", encoding="utf-8") as f:
                        baseline_records = json.load(f)
                except Exception:
                    pass

    total_records = len(new_records)
    sample_count = max(1, round((total_records * sample_rate) / 100))
    # Cap records at 500 for performance
    sample_count = min(sample_count, 500)

    # Slice the records first
    sampled_new = new_records[:sample_count]
    sampled_baseline = baseline_records[:sample_count]

    # Perform comparison
    rows, _ = compare_records(
        source,
        sampled_baseline,
        sampled_new,
        is_dataset=is_dataset,
        allowed_attrs=selected_outputs if selected_outputs else None,
        attr_mapping=attr_mapping if attr_mapping else None,
    )

    return {
        "rows": rows,
        "totalSampled": total_records,
        "sampledCount": sample_count
    }
