from __future__ import annotations

import re

from retrieve import detect_country, detect_family

WORD_NUM = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15,
    "twenty": 20, "thirty": 30, "forty": 40, "forty-five": 45, "sixty": 60,
}

FREQUENCY_PATTERNS = [
    (re.compile(r"\bevery\s+15\s*min", re.I), "Every 15 minutes", "recurring"),
    (re.compile(r"\breal[-\s]?time\b|\blive\b", re.I), "Real-time", "recurring"),
    (re.compile(r"\bhourly\b|\bevery hour\b", re.I), "Hourly", "recurring"),
    (re.compile(r"\bdaily\b|\bevery day\b", re.I), "Daily", "recurring"),
    (re.compile(r"\bweekly\b|\bevery week\b", re.I), "Weekly", "recurring"),
    (re.compile(r"\bmonthly\b|\bevery month\b", re.I), "Monthly", "recurring"),
    (re.compile(r"\bquarterly\b", re.I), "Quarterly", "recurring"),
    (re.compile(r"\bon[-\s]?demand\b", re.I), "On-demand", "one-time"),
    (re.compile(r"\bone[-\s]?time\b", re.I), "One-time", "one-time"),
]

ATTRIBUTE_HINTS = [
    (re.compile(r"\bflight numbers?\b", re.I), "Flight number"),
    (re.compile(r"\borigin\b", re.I), "Origin"),
    (re.compile(r"\bdestination\b", re.I), "Destination"),
    (re.compile(r"\bdeparture status\b", re.I), "Departure status"),
    (re.compile(r"\barrival status\b", re.I), "Arrival status"),
    (re.compile(r"\bdelay\b", re.I), "Delay"),
    (re.compile(r"\bgate\b", re.I), "Gate"),
    (re.compile(r"\bterminal\b", re.I), "Terminal"),
    (re.compile(r"\bhospital names?\b", re.I), "Hospital name"),
    (re.compile(r"\baddress(?:es)?\b", re.I), "Address"),
    (re.compile(r"\bspecialt(?:y|ies)\b", re.I), "Specialty"),
    (re.compile(r"\bbeds?\b|\bbed count\b", re.I), "Number of beds"),
    (re.compile(r"\bwebsite\b", re.I), "Website"),
    (re.compile(r"\bphone(?:\s+numbers?)?\b|\bcontact(?:\s+details?|\s+information)?\b", re.I), "Phone"),
    (re.compile(r"\bdoctors?\b", re.I), "Doctors"),
    (re.compile(r"\bservices?\b", re.I), "Services"),
    (re.compile(r"\btariff\b|\bnightly\b", re.I), "Tariffs"),
    (re.compile(r"\bamenities\b", re.I), "Amenities"),
    (re.compile(r"\breviews?\b", re.I), "Reviews"),
    (re.compile(r"\bavailability\b", re.I), "Availability"),
    (re.compile(r"\bpric(?:e|ing|es)\b", re.I), "Pricing"),
]

ENTITY_HINTS = [
    (re.compile(r"\bflights?\b|\bairlines?\b", re.I), "Flights", "Travel"),
    (re.compile(r"\bschool districts?\b|\bteachers?\b|\bk-12\b", re.I), "School districts", "Education"),
    (re.compile(r"\bhospitals?\b", re.I), "Hospitals", "Healthcare"),
    (re.compile(r"\bclinics?\b", re.I), "Clinics", "Healthcare"),
    (re.compile(r"\bhotels?\b", re.I), "Hotels", "Hospitality"),
    (re.compile(r"\bannual reports?\b|\bfinancial statements?\b", re.I), "Annual reports", "Financial"),
    (re.compile(r"\btech(?:nology)? companies\b|\bcompanies\b|\bfirmographic\b", re.I), "Companies", "Company"),
]

SOURCE_HINTS = [
    (re.compile(r"\bbse\b", re.I), "BSE"),
    (re.compile(r"\bnse\b", re.I), "NSE"),
    (re.compile(r"\bsec\s*edgar\b|\bedgar\b", re.I), "SEC EDGAR"),
    (re.compile(r"\bcompanies house\b", re.I), "Companies House"),
    (re.compile(r"\bmca\b", re.I), "MCA"),
    (re.compile(r"\bcompany websites?\b", re.I), "Company websites"),
    (re.compile(r"\blinkedin\b", re.I), "LinkedIn"),
    (re.compile(r"\bamazon\b", re.I), "Amazon"),
    (re.compile(r"\bbooking\.com\b", re.I), "Booking.com"),
    (re.compile(r"\bmakemytrip\b", re.I), "MakeMyTrip"),
    (re.compile(r"\bpracto\b", re.I), "Practo"),
]

TECH_SUBTYPES = [
    (re.compile(r"\bsaas\b", re.I), "SaaS"),
    (re.compile(r"\bit services\b", re.I), "IT Services"),
    (re.compile(r"\bfintech\b", re.I), "FinTech"),
    (re.compile(r"\bcybersecurity\b|\bcyber security\b", re.I), "Cybersecurity"),
    (re.compile(r"\bai\b|\bml\b|\bmachine learning\b", re.I), "AI/ML"),
    (re.compile(r"\be-?commerce\b", re.I), "E-commerce"),
    (re.compile(r"\bsoftware products?\b", re.I), "Software Products"),
]

HOTEL_CATEGORY = [
    (re.compile(r"\b5[-\s]?star\b", re.I), "5-star"),
    (re.compile(r"\b4[-\s]?star\b", re.I), "4-star"),
    (re.compile(r"\b3[-\s]?star\b", re.I), "3-star"),
    (re.compile(r"\bboutique\b", re.I), "Boutique"),
    (re.compile(r"\bluxury\b", re.I), "Luxury"),
    (re.compile(r"\bbudget\b", re.I), "Budget"),
]

GEO_IN_PHRASE = re.compile(
    r"\s+\bin\s+(?P<geo>india|indian|the united states|united states|usa|the us|us|uk|"
    r"united kingdom|britain|australia|canada|germany|singapore|uae|dubai|"
    r"chennai|mumbai|delhi|bengaluru|bangalore|hyderabad|pune|kolkata|london)\b",
    re.I,
)

JUNK_ATTR = re.compile(
    r"^(in|the|a|an|and|or|of|to|for|with|from|including|fields?|attributes?)$",
    re.I,
)

ALL_FIELDS = re.compile(r"^all available fields$", re.I)

INDIA_SOURCES = {"BSE", "NSE", "MCA", "MakeMyTrip", "Practo", "Company websites"}


def empty_requirement() -> dict:
    return {
        "sources": [],
        "sourceUrls": [],
        "attributes": [],
        "extras": {},
    }


def classify_intent(text: str) -> str:
    q = (text or "").strip().lower()
    if re.search(r"\b(how many|what sheets|list the (solution|agent)|catalogu?e|catalog contents)\b", q):
        return "metadata"
    if re.search(r"\b(extend|customize|also want|but also|in addition)\b", q):
        return "extend"
    if re.search(r"\b(dataset|scrape|create a|build a|refreshed|refresh(?:ed)? (daily|hourly|weekly))\b", q):
        return "create_dataset"
    if re.search(r"\b(what .+ do you have|what (hotel|company|hospital).+data)\b", q):
        return "explore"
    if re.search(r"\b(show me|list of|do you (already )?have|is there (an existing|a))\b", q):
        return "find_existing"
    if re.search(r"\bi need\b|\bi want\b", q):
        return "create_or_source"
    return "find_existing"


def extract_requirement(text: str, prior: dict | None = None) -> dict:
    prior = prior or {}
    next_req = {k: v for k, v in prior.items() if v not in (None, "", [])}
    next_req["sources"] = list(prior.get("sources") or [])
    next_req["sourceUrls"] = list(prior.get("sourceUrls") or [])
    next_req["attributes"] = list(prior.get("attributes") or [])
    next_req["extras"] = dict(prior.get("extras") or {})
    raw = (text or "").strip()
    if raw and not next_req.get("objective"):
        next_req["objective"] = raw

    intent = classify_intent(raw)
    next_req.setdefault("intent", intent)
    if intent == "metadata":
        return next_req

    family = detect_family(raw)
    country = detect_country(raw)
    if country:
        next_req.setdefault("country", country)
        next_req.setdefault("geography", country)

    _apply_entity(next_req, raw, family)
    _apply_category(next_req, raw)

    freq, recurring = _frequency(raw)
    if freq:
        next_req.setdefault("frequency", freq)
        next_req.setdefault("recurring", recurring)

    for attr in _listed_attributes(raw):
        _add_unique(next_req["attributes"], attr)

    for source in _listed_sources(raw):
        _add_unique(next_req["sources"], source)

    urls = re.findall(r"https?://[^\s)]+", raw)
    for url in urls:
        _add_unique(next_req["sourceUrls"], url)

    if not next_req.get("geography") and any(src in INDIA_SOURCES for src in next_req["sources"]):
        next_req["country"] = next_req.get("country") or "India"
        next_req["geography"] = "India"

    ranking = _ranking(raw)
    if ranking:
        next_req["extras"].setdefault("volume", ranking["volume"])
        next_req["extras"].setdefault("rankingHint", ranking["hint"])
        if not next_req["extras"].get("rankingMethod"):
            next_req["extras"]["rankingUnresolved"] = "true"

    if re.search(r"\bflight status\b", raw, re.I):
        next_req.setdefault("dataType", "Flight status")
        next_req["extras"].setdefault("dataType", "Flight status")

    if re.search(r"\bhistorical\b|\blast \d+ years?\b", raw, re.I):
        next_req.setdefault("historical", _historical(raw))

    next_req["attributes"] = _normalize_attributes(next_req["attributes"])
    return next_req


def field_status(req: dict, family: str | None = None) -> dict[str, str]:
    """Known / unknown / not_required for each scope dimension."""
    extras = req.get("extras") or {}
    entity = (req.get("entityType") or "").lower()
    family = family or extras.get("family") or ""
    status = {
        "entity": "known" if req.get("entityType") else "unknown",
        "category": "known" if req.get("category") else "unknown",
        "subCategory": "known" if req.get("subIndustry") else "unknown",
        "geography": "known" if req.get("geography") or req.get("country") or req.get("city") else "unknown",
        "sources": "known" if req.get("sources") or req.get("sourceUrls") or extras.get("sourcesDeferred") == "true" or extras.get("sourceMode") else "unknown",
        "sourceNames": (
            "unknown"
            if extras.get("needSourceNames") == "true" and not (req.get("sources") or req.get("sourceUrls"))
            else "not_required"
        ),
        "attributes": "known" if req.get("attributes") else "unknown",
        "frequency": "known" if req.get("frequency") or req.get("recurring") else "unknown",
        "historical": "known" if req.get("historical") else "unknown",
        "volume": "known" if extras.get("volume") or req.get("volume") else "unknown",
        "output": "known" if extras.get("output") or req.get("output") else "not_required",
        "inclusion": "known" if extras.get("scope") or extras.get("inclusion") else "unknown",
        "companyType": "known" if extras.get("companyType") or extras.get("scope") else "unknown",
        "sizeFilter": "known" if extras.get("sizeFilter") else "unknown",
        "listSize": "known" if extras.get("listSize") or extras.get("volume") or req.get("volume") else "unknown",
        "reportKind": "known" if extras.get("reportKind") else "unknown",
        "ranking": (
            "unknown"
            if extras.get("rankingUnresolved") == "true" and not extras.get("rankingMethod")
            else "not_required"
        ),
    }
    is_financial = "annual" in entity or "financial" in entity or family == "financial"
    is_company = entity == "companies" or family in {"firmographic", "registry"}
    is_firmographic = family == "firmographic" or (entity == "companies" and family != "registry")
    is_hotel = entity == "hotels" or family == "hospitality"
    if not is_financial:
        status["historical"] = "not_required" if status["historical"] == "unknown" else status["historical"]
        status["reportKind"] = "not_required"
    else:
        if status["category"] == "unknown":
            status["category"] = "not_required"
    if not is_company:
        if status["subCategory"] == "unknown":
            status["subCategory"] = "not_required"
    elif (req.get("industry") or "").lower() == "technology":
        if status["category"] == "unknown":
            status["category"] = "known"
    elif status["subCategory"] == "unknown":
        status["subCategory"] = "not_required"
    if is_hotel:
        if req.get("category"):
            status["inclusion"] = "known"
        elif status["inclusion"] == "unknown":
            status["inclusion"] = "not_required"
    if is_firmographic:
        # Ownership, size, and list length are separate questions. The old combined scope question is not used.
        status["inclusion"] = "not_required"
    else:
        for key in ("companyType", "sizeFilter", "listSize"):
            if status[key] == "unknown":
                status[key] = "not_required"
    if (
        not is_firmographic
        and status["sources"] == "unknown"
        and status["entity"] == "known"
        and status["geography"] == "known"
        and status["attributes"] == "known"
    ):
        # Enough to use suitable public sources — don't force a sources questionnaire.
        status["sources"] = "not_required"
    status["volume"] = "not_required" if status["volume"] == "unknown" else status["volume"]
    return status


def scope_summary(req: dict) -> dict[str, str]:
    """Programmatic confirmation copy — never a chat-history dump."""
    extras = req.get("extras") or {}
    rows: dict[str, str] = {}
    objective = req.get("objective")
    if objective:
        rows["Objective"] = _short_objective(req)
    if req.get("entityType"):
        rows["Entity"] = req["entityType"]
    category_bits = [req.get("industry"), req.get("category"), req.get("subIndustry")]
    category = " / ".join(dict.fromkeys(bit for bit in category_bits if bit))
    if category:
        rows["Category"] = category
    geo = req.get("geography") or req.get("country") or req.get("city")
    if geo:
        rows["Geography"] = geo
    attrs = _normalize_attributes(req.get("attributes") or [])
    if attrs:
        rows["Required data"] = ", ".join(attrs)
    sources = req.get("sources") or []
    if sources:
        rows["Sources"] = ", ".join(sources)
    elif extras.get("sourcePolicy"):
        rows["Sources"] = extras["sourcePolicy"]
    elif extras.get("sourcesDeferred") == "true":
        rows["Sources"] = "Suitable public / catalog sources"
    if extras.get("companyType"):
        rows["Company type"] = extras["companyType"]
    if extras.get("sizeFilter"):
        rows["Size filter"] = extras["sizeFilter"]
    if extras.get("listSize"):
        rows["List size"] = extras["listSize"]
    if extras.get("scope") or extras.get("inclusion"):
        rows["Scope"] = extras.get("scope") or extras.get("inclusion")
    if extras.get("reportKind"):
        rows["Report type"] = extras["reportKind"]
    if req.get("frequency") or req.get("recurring"):
        rows["Frequency"] = req.get("frequency") or req.get("recurring")
    if req.get("historical"):
        rows["Historical data"] = req["historical"]
    volume = extras.get("volume") or req.get("volume")
    if volume:
        rows["Volume"] = volume
    output = extras.get("output") or req.get("output")
    if output:
        rows["Output"] = output
    return rows or {"Requirement": req.get("objective") or "New data scope"}


def _short_objective(req: dict) -> str:
    entity = (req.get("entityType") or "records").lower()
    geo = req.get("geography") or req.get("country")
    freq = req.get("frequency")
    if freq and freq.lower() not in {"one-time", "on-demand"}:
        lead = "Create a recurring dataset"
    else:
        lead = "Create a dataset"
    bits = [lead, f"of {entity}"]
    if geo:
        bits.append(f"in {geo}")
    return " ".join(bits) + "."


def _apply_entity(next_req: dict, text: str, family: str | None) -> None:
    for pattern, entity, industry in ENTITY_HINTS:
        if pattern.search(text):
            next_req.setdefault("entityType", entity)
            next_req.setdefault("industry", industry)
            break
    if re.search(r"\btech(?:nology)?\b", text, re.I) and (next_req.get("entityType") or "").lower() == "companies":
        next_req["industry"] = "Technology"
        next_req.setdefault("category", "Technology")
    if family == "healthcare":
        next_req.setdefault("industry", "Healthcare")
        next_req.setdefault("entityType", next_req.get("entityType") or "Hospitals")
    elif family == "travel":
        next_req.setdefault("industry", "Travel")
        next_req.setdefault("entityType", next_req.get("entityType") or "Flights")
    elif family == "education":
        next_req.setdefault("industry", "Education")
        next_req.setdefault("entityType", next_req.get("entityType") or "School districts")
    elif family == "hospitality":
        next_req.setdefault("industry", "Hospitality")
        next_req.setdefault("entityType", next_req.get("entityType") or "Hotels")
    elif family == "financial":
        next_req.setdefault("industry", "Financial")
        next_req.setdefault("entityType", next_req.get("entityType") or "Annual reports")
    elif family == "firmographic":
        next_req.setdefault("industry", next_req.get("industry") or "Company")
        next_req.setdefault("entityType", "Companies")


def _apply_category(next_req: dict, text: str) -> None:
    for pattern, label in HOTEL_CATEGORY:
        if pattern.search(text):
            next_req.setdefault("category", label)
            break
    for pattern, label in TECH_SUBTYPES:
        if pattern.search(text):
            next_req.setdefault("subIndustry", label)
            break


def _frequency(text: str) -> tuple[str | None, str | None]:
    for pattern, value, recurring in FREQUENCY_PATTERNS:
        if pattern.search(text):
            return value, recurring
    match = re.search(r"\bevery\s+(\d+|[a-z\-]+)\s*(hours?|hrs?)\b", text, re.I)
    if match:
        raw, unit = match.group(1), match.group(2)
        n = WORD_NUM.get(raw.lower()) if not raw.isdigit() else int(raw)
        if n:
            label = "hour" if n == 1 else "hours"
            return f"Every {n} {label}", "recurring"
    return None, None


def _listed_attributes(text: str) -> list[str]:
    found: list[str] = []
    clause = None
    split = re.search(r"\b(?:including|with|fields?|attributes?)\b(.+)$", text, re.I)
    if split:
        clause = split.group(1)
        clause = GEO_IN_PHRASE.sub("", clause)
        for part in re.split(r",| and | & |/", clause):
            label = _clean_attr(part)
            if label:
                _add_unique(found, label)
    if found:
        return found
    for pattern, label in ATTRIBUTE_HINTS:
        if pattern.search(text) and label not in found:
            found.append(label)
    if found == ["Flight status"] or (
        len(found) == 1 and "status" in found[0].lower() and "flight" in text.lower()
    ):
        return []
    return found


def _clean_attr(raw: str) -> str | None:
    label = GEO_IN_PHRASE.sub("", raw).strip(" .;:")
    label = re.sub(r"\s+", " ", label)
    if not label or len(label) < 3 or len(label) > 60:
        return None
    if JUNK_ATTR.match(label):
        return None
    if ALL_FIELDS.match(label):
        return "All available fields"
    if re.match(r"^phone(\s+numbers?)?$", label, re.I):
        return "Phone"
    if re.match(r"^(hq\s+)?address(es)?$", label, re.I):
        return "Address"
    return label[0].upper() + label[1:]


def _listed_sources(text: str) -> list[str]:
    found: list[str] = []
    for pattern, name in SOURCE_HINTS:
        if pattern.search(text):
            _add_unique(found, name)
    return found


def _normalize_attributes(attrs: list[str]) -> list[str]:
    cleaned: list[str] = []
    saw_all = False
    for item in attrs:
        label = _clean_attr(item) if item else None
        if not label:
            continue
        if ALL_FIELDS.match(label):
            saw_all = True
            continue
        _add_unique(cleaned, label)
    if saw_all:
        return ["All available fields"]
    return cleaned


def _ranking(text: str) -> dict | None:
    match = re.search(r"\btop\s+(\d+)\b", text, re.I)
    if not match:
        return None
    n = match.group(1)
    by_match = re.search(r"\bby\s+([a-z0-9 \-]+?)(?:\s*,|\s+including|\s*$)", text, re.I)
    basis = (by_match.group(1).strip() if by_match else "").rstrip(".,")
    hint = f"top {n}" + (f" by {basis}" if basis else "")
    return {"volume": f"Top {n}", "hint": hint}


def _historical(text: str) -> str:
    match = re.search(r"last\s+(\d+)\s+years?", text, re.I)
    if match:
        return f"Last {match.group(1)} years"
    if re.search(r"\bcurrent\b|\blatest\b", text, re.I):
        return "Current/latest data"
    return "Historical data"


def _add_unique(bucket: list[str], item: str) -> None:
    if item and item not in bucket:
        bucket.append(item)
