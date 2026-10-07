from __future__ import annotations

import re

from extract_req import field_status
from retrieve import detect_family

Question = dict

ALL_FIELDS = re.compile(r"all available fields", re.I)
SOURCE_POLICY = re.compile(
    r"^(specific websites?|official sources only|suitable public sources|no preference|"
    r"i'?ll upload a list|ask the freda team to generate a list|"
    r"get the list from wikipedia or a third party)$",
    re.I,
)
SPECIFIC_SITES = re.compile(r"specific websites?", re.I)
OFFICIAL_SOURCES = re.compile(r"official sources only", re.I)
UPLOAD_LIST = re.compile(r"upload a list", re.I)
FREDA_LIST = re.compile(r"freda team", re.I)
THIRD_PARTY_LIST = re.compile(r"wikipedia|third party", re.I)

COMPANY_TYPE_CHOICES = ["Public", "Private", "Startup", "All companies"]
SIZE_FILTER_CHOICES = [
    "Filter by employee count",
    "Filter by annual revenue range",
    "No size filter",
]
LIST_SIZE_CHOICES = ["Top 50", "Top 100", "Top 250", "Top 500", "All matching companies"]
COMPANY_LIST_SOURCE_CHOICES = [
    "I'll upload a list",
    "Ask the Freda team to generate a list",
    "Get the list from Wikipedia or a third party",
]

# Ask at most these dimensions, and only when still unknown/required.
# This is a checklist of what *may* be missing — not a questionnaire to walk in full.
DIMENSIONS: list[tuple[str, str]] = [
    ("entity", "entityType"),
    ("ranking", "extras.rankingMethod"),
    ("category", "category"),
    ("subCategory", "subIndustry"),
    ("reportKind", "extras.reportKind"),
    ("geography", "geography"),
    ("companyType", "extras.companyType"),
    ("sizeFilter", "extras.sizeFilter"),
    ("listSize", "extras.listSize"),
    ("sources", "sources"),
    ("sourceNames", "sourceNames"),
    ("attributes", "attributes"),
    ("inclusion", "extras.scope"),
    ("frequency", "frequency"),
    ("historical", "historical"),
]


def family_for(text: str, current: str | None = None) -> str:
    return detect_family(text or "") or current or "generic"


def missing_field(family: str, req: dict, asked: list[str]) -> str | None:
    status = field_status(req, family)
    asked_set = set(asked or [])
    for status_key, field in DIMENSIONS:
        if field in asked_set:
            continue
        if status.get(status_key) != "unknown":
            continue
        return field
    return None


def next_question(
    family: str,
    req: dict,
    asked: list[str],
    catalog: dict | None = None,
    solution_hits: list | None = None,
) -> Question | None:
    """Build one entity-specific question for the next missing required field."""
    field = missing_field(family, req, asked)
    if not field:
        return None
    return synthesize_question(field, req, family, catalog=catalog, solution_hits=solution_hits)


def synthesize_question(
    field: str,
    req: dict,
    family: str,
    catalog: dict | None = None,
    solution_hits: list | None = None,
) -> Question:
    entity = req.get("entityType") or _entity_from_family(family)
    known = _known_bits(req)
    choices, multi = _choices_for(field, entity, req, catalog, solution_hits)
    prompt = _prompt_for(field, entity, known, req)
    question: Question = {
        "field": field,
        "prompt": prompt,
        "choices": choices,
        "multi": multi,
        "allowOther": True,
    }
    if field == "attributes":
        question["selected"] = [item for item in (req.get("attributes") or []) if item]
    if field == "sourceNames":
        question["selected"] = [item for item in (req.get("sources") or []) if item]
    return question


def requirement_complete(family: str, req: dict, asked: list[str]) -> bool:
    return missing_field(family, req, asked) is None


def apply_answer(req: dict, field: str, text: str, available: list[str] | None = None) -> dict:
    next_req = {
        **req,
        "sources": list(req.get("sources") or []),
        "sourceUrls": list(req.get("sourceUrls") or []),
        "attributes": list(req.get("attributes") or []),
        "extras": dict(req.get("extras") or {}),
    }
    trimmed = (text or "").strip()
    parts = [part.strip() for part in re.split(r"[;|]", trimmed) if part.strip()]
    available_set = {item.lower() for item in (available or [])}

    if field == "geography":
        next_req["geography"] = trimmed
        if trimmed in {"India", "US", "UK"}:
            next_req["country"] = trimmed
    elif field == "entityType":
        next_req["entityType"] = trimmed
    elif field == "industry":
        next_req["industry"] = trimmed
    elif field == "category":
        next_req["category"] = trimmed
    elif field == "subIndustry":
        next_req["subIndustry"] = trimmed
    elif field == "historical":
        next_req["historical"] = trimmed
    elif field == "attributes":
        selected = _selected_only(parts, trimmed, available_set)
        if any(ALL_FIELDS.search(part) for part in selected) or ALL_FIELDS.search(trimmed):
            next_req["attributes"] = ["All available fields"]
        else:
            previous = list(next_req["attributes"] or [])
            preserved: list[str] = []
            if available_set:
                for item in previous:
                    if item.lower() not in available_set:
                        preserved.append(item)
            merged: list[str] = []
            for item in [*preserved, *selected]:
                if item and item not in merged:
                    merged.append(item)
            next_req["attributes"] = merged or previous
    elif field in {"sources", "sourceNames"}:
        extras = next_req["extras"]
        if field == "sources" and SOURCE_POLICY.match(trimmed):
            extras.pop("needSourceNames", None)
            if SPECIFIC_SITES.search(trimmed):
                extras["sourceMode"] = "specific"
                extras["needSourceNames"] = "true"
                extras.pop("sourcesDeferred", None)
                extras.pop("sourcePolicy", None)
            elif OFFICIAL_SOURCES.search(trimmed):
                extras["sourceMode"] = "official"
                extras["sourcePolicy"] = "Official sources only"
                extras["sourcesDeferred"] = "true"
                extras.pop("needSourceNames", None)
            elif UPLOAD_LIST.search(trimmed):
                extras["sourceMode"] = "upload"
                extras["sourcePolicy"] = "User uploads a list"
                extras.pop("needSourceNames", None)
                extras.pop("sourcesDeferred", None)
            elif FREDA_LIST.search(trimmed):
                extras["sourceMode"] = "freda"
                extras["sourcePolicy"] = "Freda team generates the list"
                extras["sourcesDeferred"] = "true"
                extras.pop("needSourceNames", None)
            elif THIRD_PARTY_LIST.search(trimmed):
                extras["sourceMode"] = "third_party"
                extras["sourcePolicy"] = "Wikipedia or a third party"
                extras["sourcesDeferred"] = "true"
                extras.pop("needSourceNames", None)
            else:
                extras["sourceMode"] = "public"
                extras["sourcesDeferred"] = "true"
                extras.pop("needSourceNames", None)
                extras.pop("sourcePolicy", None)
        else:
            extras.pop("needSourceNames", None)
            extras.pop("sourcesDeferred", None)
            extras["sourceMode"] = "named"
            for part in parts:
                if SOURCE_POLICY.match(part):
                    continue
                if part not in next_req["sources"]:
                    next_req["sources"].append(part)
            for part in parts:
                if re.match(r"https?://", part, re.I) and part not in next_req["sourceUrls"]:
                    next_req["sourceUrls"].append(part)
    elif field == "frequency":
        next_req["frequency"] = trimmed
        next_req["recurring"] = "one-time" if re.search(r"one[-\s]?time", trimmed, re.I) else "recurring"
    elif field.startswith("extras."):
        key = field.split(".", 1)[1]
        next_req["extras"][key] = trimmed
        if key == "rankingMethod":
            next_req["extras"]["rankingUnresolved"] = "false"
        if key == "listSize":
            next_req["extras"]["volume"] = trimmed
    else:
        next_req[field] = trimmed
    return next_req


def _selected_only(parts: list[str], trimmed: str, _available: set[str]) -> list[str]:
    """Never copy the option list into the requirement unless the user selected it."""
    return [part for part in parts if part] or ([trimmed] if trimmed else [])


def _entity_from_family(family: str) -> str:
    return {
        "hospitality": "Hotels",
        "healthcare": "Hospitals",
        "travel": "Flights",
        "financial": "Annual reports",
        "firmographic": "Companies",
        "registry": "Companies",
        "product": "Products",
    }.get(family or "", "records")


def _known_bits(req: dict) -> list[str]:
    bits: list[str] = []
    if req.get("entityType"):
        bits.append(str(req["entityType"]).lower())
    industry = req.get("industry") or req.get("category")
    if industry and industry.lower() not in {b.lower() for b in bits}:
        bits.append(str(industry).lower())
    if req.get("subIndustry"):
        bits.append(str(req["subIndustry"]))
    geo = req.get("geography") or req.get("country")
    if geo:
        bits.append(f"in {geo}")
    attrs = req.get("attributes") or []
    if attrs:
        bits.append("needing " + ", ".join(attrs[:4]))
    sources = req.get("sources") or []
    if sources:
        bits.append("from " + ", ".join(sources[:4]))
    return bits


def _prompt_for(field: str, entity: str, known: list[str], req: dict) -> str:
    label = (entity or "records").rstrip("s") if entity != "Annual reports" else "annual report"
    scope = " ".join(known) if known else label
    extras = req.get("extras") or {}
    prompts = {
        "entityType": "What entity or data type are you trying to collect?",
        "category": f"Which {label.lower()} categories should be included?",
        "subIndustry": (
            f"What type of {req.get('industry') or entity} should be included?"
            if req.get("industry")
            else f"Which type of {label.lower()} should be included?"
        ),
        "extras.reportKind": "Do you need the original annual report documents, extracted financial data, or both?",
        "geography": f"Which geography or market should the {label.lower()} dataset cover?",
        "sources": "Do you have specific websites or sources that should be included?",
        "sourceNames": "Which websites or source names should Freda use?",
        "attributes": f"What information would you like Freda to collect for each {label.lower()} record?",
        "extras.companyType": f"Which types of {label.lower()} should be included?",
        "extras.sizeFilter": f"Should the {label.lower()} list be filtered by size?",
        "extras.listSize": f"How many {label.lower()} records do you want?",
        "extras.scope": f"Which {label.lower()} records should be included in the dataset?",
        "frequency": "How frequently should the data be collected or refreshed?",
        "historical": "Do you need current data only, or historical data as well?",
        "extras.rankingMethod": (
            f'Should "{extras.get("rankingHint") or "this ranking"}" use a specific ranking/source, '
            "or should Freda build it from available public information?"
        ),
    }
    prompt = prompts.get(field, f"What else is required to complete the {scope} scope?")
    if known and field not in {"entityType", "extras.rankingMethod", "sourceNames"}:
        return f"For {scope}: {prompt[0].lower() + prompt[1:]}" if prompt else prompt
    return prompt


def _choices_for(
    field: str,
    entity: str,
    req: dict,
    catalog: dict | None,
    solution_hits: list | None,
) -> tuple[list[str], bool]:
    kind = (entity or "").lower()
    if field == "entityType":
        return ["Companies", "People", "Locations", "Products", "Hotels", "Hospitals", "Other"], False
    if field in {"category", "subIndustry"}:
        return _category_choices(kind, req), False
    if field == "extras.reportKind":
        return ["Original reports", "Extracted financial data", "Both"], False
    if field == "geography":
        return ["Global", "India", "US", "UK", "Europe", "Specific states", "Specific cities"], False
    if field == "sources":
        if _is_company_list(kind, req):
            return list(COMPANY_LIST_SOURCE_CHOICES), False
        return ["Specific websites", "Official sources only", "Suitable public sources", "No preference"], False
    if field == "extras.companyType":
        return list(COMPANY_TYPE_CHOICES), True
    if field == "extras.sizeFilter":
        return list(SIZE_FILTER_CHOICES), True
    if field == "extras.listSize":
        return list(LIST_SIZE_CHOICES), False
    if field == "sourceNames":
        return _source_name_choices(req, catalog, solution_hits), True
    if field == "attributes":
        choices = _attribute_choices(kind, req, catalog, solution_hits)
        return choices, True
    if field == "extras.scope":
        return _inclusion_choices(kind, req), False
    if field == "frequency":
        return ["Real-time", "Hourly", "Daily", "Weekly", "Monthly", "Quarterly", "On-demand", "One-time"], False
    if field == "historical":
        return ["Current/latest data", "Historical data", "Both"], False
    if field == "extras.rankingMethod":
        return ["Specific ranking/source", "Build from public information", "Other"], False
    return ["Yes", "No", "Other"], False


def _category_choices(kind: str, req: dict) -> list[str]:
    industry = (req.get("industry") or "").lower()
    if "hotel" in kind or "hospitality" in kind:
        return ["5-star", "4-star", "3-star", "Budget", "Luxury", "Boutique", "All"]
    if "hospital" in kind or "clinic" in kind or "healthcare" in kind:
        return ["Hospitals", "Clinics", "Specialty hospitals", "Diagnostic centres", "All"]
    if "flight" in kind or "travel" in kind:
        return ["Domestic", "International", "Both"]
    if "annual" in kind or "financial" in kind:
        return ["Listed companies", "Private companies", "Both"]
    if "compan" in kind or industry == "technology":
        if industry == "technology" or "tech" in (req.get("objective") or "").lower():
            return ["SaaS", "Software Products", "IT Services", "AI/ML", "Cybersecurity", "FinTech", "All", "Other"]
        return ["Technology", "SaaS", "IT Services", "FinTech", "E-commerce", "Cybersecurity", "All", "Other"]
    return ["All", "Specific subset", "Other"]


def _is_company_list(kind: str, req: dict) -> bool:
    family = ((req.get("extras") or {}).get("family") or "").lower()
    return "compan" in (kind or "") or family == "firmographic"


def _inclusion_choices(kind: str, req: dict) -> list[str]:
    geo = req.get("geography") or req.get("country") or "the selected market"
    if "compan" in kind:
        return ["All companies", "Public companies", "Private companies", "Enterprise", "Startup", "Other"]
    if "hotel" in kind:
        category = req.get("category") or "matching hotels"
        return [f"All {category} hotels in {geo}", "Currently operating only", "Specific chains", "Other"]
    if "annual" in kind:
        sources = ", ".join(req.get("sources") or []) or "the named sources"
        return [f"All companies from {sources}", "Specific sectors", "Specific companies", "Market-cap range", "Other"]
    if "flight" in kind:
        return ["All flights", "Specific airlines", "Specific airports"]
    return [f"All matching {kind or 'records'} in {geo}", "Apply a filter", "Other"]


# Shared Solutions list one attribute set for several entities. ds-travel's catalog
# fields are hotel property fields and must not be offered for a flight record.
_HOTEL_ONLY_ATTR = re.compile(
    r"propert(?:y|ies)|chain|\bstars?\b|star rating|room types?|amenities|nightly|"
    r"cancellation|review score|review count|ota source|listing url|\baddress\b|"
    r"\bcity\b|\bcountry\b|latitude|longitude|banquet|cuisine|\bmenu\b|venue name",
    re.I,
)
_FLIGHT_ATTR = re.compile(
    r"flight|airline|origin|destination|depart|arriv|fare|baggage|layover|duration|aircraft|gate|terminal|\bdelay\b",
    re.I,
)


def _is_flight_kind(kind: str) -> bool:
    return "flight" in kind or "airline" in kind or kind.strip() == "travel"


def _domain_attributes(kind: str) -> list[str]:
    if _is_flight_kind(kind):
        return [
            "Flight number",
            "Airline",
            "Origin",
            "Destination",
            "Departure time",
            "Arrival time",
            "Fare class",
            "Price",
            "Layovers",
            "Duration",
            "Baggage allowance",
            "Aircraft type",
        ]
    if "hotel" in kind or "hospitality" in kind:
        return ["Pricing", "Availability", "Amenities", "Reviews", "Address", "Contact details", "Room types"]
    if "hospital" in kind or "clinic" in kind or "healthcare" in kind:
        return ["Facility details", "Doctors", "Specialties", "Address", "Contact", "Services", "Insurance accepted"]
    if "annual" in kind or "financial" in kind:
        return ["Original report", "Financial statements", "KPIs", "Filing dates", "Company information"]
    if "product" in kind:
        return ["Current price", "List price", "Promo", "Seller", "Stock"]
    if "compan" in kind:
        return ["Company details", "Address", "Phone", "Products/services", "Revenue", "Employees", "Executives"]
    return ["Identity", "Contacts", "Location"]


def _relevant_catalog_attributes(kind: str, attrs: list[str]) -> list[str]:
    """Keep catalog fields that belong to this entity, not a sibling on the same Solution."""
    if _is_flight_kind(kind):
        return [attr for attr in attrs if _FLIGHT_ATTR.search(attr) and not _HOTEL_ONLY_ATTR.search(attr)]
    if "hotel" in kind or "hospitality" in kind:
        return [attr for attr in attrs if not _FLIGHT_ATTR.search(attr)]
    return attrs


def coerce_attribute_choices(entity: str, choices: list[str], known: list[str] | None = None) -> list[str]:
    """Drop sibling-vertical fields the model copied from a mixed Solution."""
    kind = (entity or "").lower()
    if not _is_flight_kind(kind):
        return list(choices or [])
    kept: list[str] = []
    for item in [*(known or []), *(choices or [])]:
        label = str(item or "").strip()
        if not label or ALL_FIELDS.search(label):
            continue
        if _HOTEL_ONLY_ATTR.search(label) and not _FLIGHT_ATTR.search(label):
            continue
        if label not in kept:
            kept.append(label)
    flight_labels = [item for item in kept if _FLIGHT_ATTR.search(item)]
    if len(flight_labels) < 4:
        for item in _domain_attributes(kind):
            if item not in kept:
                kept.append(item)
    kept = kept[:11]
    kept.append("All available fields")
    return kept


def _attribute_choices(
    kind: str,
    req: dict,
    catalog: dict | None,
    solution_hits: list | None,
) -> list[str]:
    known = [str(item).strip() for item in (req.get("attributes") or []) if str(item).strip()]
    catalog_attrs = _relevant_catalog_attributes(kind, _catalog_attributes(kind, catalog, solution_hits))
    domain = _domain_attributes(kind)
    # A mixed Solution (hotels + flights) often has no fields for this entity.
    # Fewer than four relevant catalog fields means fill from the entity's own vocabulary.
    if _is_flight_kind(kind) or len(catalog_attrs) < 4:
        generated = [*catalog_attrs, *domain]
    else:
        generated = catalog_attrs or domain
    choices: list[str] = []
    for item in [*known, *generated]:
        if item and item not in choices and not ALL_FIELDS.search(item):
            choices.append(item)
    choices = choices[:11]
    choices.append("All available fields")
    return choices


def _source_name_choices(req: dict, catalog: dict | None, solution_hits: list | None) -> list[str]:
    found: list[str] = []
    for name in req.get("sources") or []:
        if name and name not in found:
            found.append(name)
    for sol in solution_hits or []:
        for name in sol.get("sourceNames") or []:
            label = str(name).strip()
            if label and label not in found:
                found.append(label)
    if catalog:
        for src in catalog.get("sources") or []:
            label = str(src.get("name") or "").strip()
            if label and label not in found:
                found.append(label)
            if len(found) >= 8:
                break
    return found[:8]


def _catalog_attributes(kind: str, catalog: dict | None, solution_hits: list | None) -> list[str]:
    rows = list(solution_hits or [])
    if catalog:
        rows.extend(catalog.get("solutions") or [])
    needle = (kind or "").rstrip("s").lower()
    found: list[str] = []
    for sol in rows:
        blob = " ".join(
            str(sol.get(key) or "")
            for key in ("name", "category", "tagline", "description", "industry")
        ).lower()
        if needle and needle not in blob and kind.lower() not in blob:
            continue
        for attr in sol.get("attributes") or []:
            label = str(attr).strip()
            if label and label not in found:
                found.append(label)
        if len(found) >= 8:
            break
    return found
