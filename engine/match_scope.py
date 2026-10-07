from __future__ import annotations

import re

from extract_req import field_status

STOP = {
    "the", "and", "for", "with", "from", "that", "this", "need", "want", "show",
    "list", "data", "in", "of", "a", "an", "to", "me", "i", "please",
}

USE_CASE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("financial_filings", re.compile(r"\b(annual reports?|10-k|10-q|financial statements?|filings?|balance sheet|p&l|bse|nse|edgar)\b", re.I)),
    ("healthcare", re.compile(r"\b(hospital|hospitals|clinic|clinics|doctor|doctors|physician|healthcare|specialt(?:y|ies)|nabh|practo)\b", re.I)),
    ("hospitality", re.compile(r"\b(hotel|hotels|resort|restaurant|restaurants|venue|venues|hospitality|tariff|nightly)\b", re.I)),
    ("travel", re.compile(r"\b(flight|flights|airlines?|ota|booking\.com|expedia|kayak|cruise)\b", re.I)),
    ("education", re.compile(r"\b(school districts?|public schools?|k-12|teachers?|nces)\b", re.I)),
    ("registry", re.compile(r"\b(registry|gst|gstin|mca|companies house|lei|beneficial owner|incorporation|directors|compliance)\b", re.I)),
    ("legal", re.compile(r"\b(attorney|advocate|law firm|bar council|legal)\b", re.I)),
    ("contacts", re.compile(r"\b(people|contacts|emails?|decision[-\s]?makers?|linkedin)\b", re.I)),
    ("ecommerce", re.compile(r"\b(product|sku|ecommerce|e-commerce|marketplace|amazon|walmart|asin)\b", re.I)),
    ("jobs", re.compile(r"\b(job posting|job listings|open roles|indeed|careers page)\b", re.I)),
    ("company_directory", re.compile(
        r"\b(firmographic|company profiles?|tech(?:nology)? companies|list of (?:tech(?:nology)? )?companies|companies in\b|address and phone)\b",
        re.I,
    )),
]

SOLUTION_USE_CASE_HINTS: list[tuple[str, re.Pattern[str]]] = [
    ("financial_filings", re.compile(r"financial statement|annual report|10-k|filings|kpi", re.I)),
    ("registry", re.compile(r"registry|compliance|beneficial owner|directors|lei", re.I)),
    ("hospitality", re.compile(r"hotel|restaurant|venue|tariff|hospitality", re.I)),
    ("travel", re.compile(r"\b(flights?|airfare|airlines?|hotel/flight)\b", re.I)),
    ("education", re.compile(r"school district|k-12|education|teacher|nces", re.I)),
    ("healthcare", re.compile(r"\b(hospitals?|clinics?|doctors?|physicians?|healthcare|providers?)\b", re.I)),
    ("legal", re.compile(r"attorney|law firm|advocate", re.I)),
    ("contacts", re.compile(r"people|contact|decision-maker", re.I)),
    ("company_directory", re.compile(r"firmographic|company profile|b2b company", re.I)),
    ("ecommerce", re.compile(r"e-commerce|product data|sku|competitor price", re.I)),
    ("jobs", re.compile(r"job posting|open roles", re.I)),
    ("automotive", re.compile(r"dealer|vin|automotive|rental", re.I)),
    ("location", re.compile(r"location|poi|store locator", re.I)),
    ("real_estate", re.compile(r"real estate|listing", re.I)),
    ("news", re.compile(r"news|intent signal", re.I)),
    ("insurance", re.compile(r"insurance|premium", re.I)),
]


def user_use_cases(text: str, req: dict) -> set[str]:
    blob = " ".join(part for part in [text, req.get("entityType"), req.get("industry"), req.get("objective")] if part)
    found: set[str] = set()
    for name, pattern in USE_CASE_PATTERNS:
        if pattern.search(blob or ""):
            found.add(name)
    entity = (req.get("entityType") or "").lower()
    if entity == "hotels":
        found.add("hospitality")
        if any(attr.lower() in {"pricing", "availability", "reviews"} for attr in req.get("attributes") or []):
            found.add("travel")
    if entity in {"companies", "company profiles"} and "registry" not in found and "financial_filings" not in found:
        found.add("company_directory")
    if entity in {"flights", "airlines"}:
        found.add("travel")
    if entity in {"school districts", "teachers"}:
        found.add("education")
    if entity in {"annual reports", "financial statements / annual reports"}:
        found.add("financial_filings")
    return found or {"generic"}


def solution_use_cases(solution: dict) -> set[str]:
    blob = " ".join(
        [
            solution.get("id") or "",
            solution.get("name") or "",
            solution.get("category") or "",
            solution.get("tagline") or "",
            solution.get("description") or "",
        ]
    )
    found: set[str] = set()
    for name, pattern in SOLUTION_USE_CASE_HINTS:
        if pattern.search(blob):
            found.add(name)
    sol_id = (solution.get("id") or "").lower()
    if sol_id == "ds-travel":
        found.update({"travel", "hospitality"})
    if sol_id == "ds-hospitality-venues":
        found.add("hospitality")
    if sol_id == "ds-healthcare-providers":
        found.add("healthcare")
    if sol_id == "ds-firmographic":
        found.add("company_directory")
    if sol_id == "ds-financial":
        found.add("financial_filings")
    if sol_id == "ds-registry":
        found.add("registry")
    if sol_id == "ds-us-public-school-district-workforce":
        found.add("education")
    if sol_id == "ds-funding":
        found.add("funding")
    return found or {"generic"}


def match_capabilities(
    query: str,
    req: dict,
    catalog: dict,
    semantic_scores: dict[str, float] | None = None,
) -> dict:
    use_cases = user_use_cases(query, req)
    required_attrs = [a for a in (req.get("attributes") or []) if not re.match(r"^all available fields$", a, re.I)]
    required_sources = list(req.get("sources") or [])
    solutions = catalog.get("solutions") or []
    injected = semantic_scores is not None
    scores = dict(semantic_scores or {})

    def collect(sem: dict[str, float]) -> list[dict]:
        best_sem = max(sem.values(), default=0.0)
        sem_cutoff = max(0.50, best_sem - 0.12) if best_sem >= 0.50 else 1.0
        hits: list[dict] = []
        for solution in solutions:
            related = [s for s in catalog.get("sources") or [] if s.get("solutionId") == solution["id"]]
            sol_cases = solution_use_cases(solution)
            overlap = (use_cases - {"generic"}) & (sol_cases - {"generic"})
            sim = float(sem.get(str(solution.get("id") or ""), 0.0) or 0.0)
            if not overlap and sim < sem_cutoff:
                continue
            report = _score_solution(
                query,
                req,
                solution,
                related,
                use_cases,
                sol_cases,
                required_attrs,
                required_sources,
                semantic=sim,
            )
            if report["band"] == "irrelevant":
                continue
            hits.append({**solution, **report, "relatedSources": related, "semantic": sim})
        hits.sort(key=lambda h: h["score"], reverse=True)
        return [h for h in hits if h["score"] >= 40][:4]

    solution_hits = collect(scores)
    # Keywords are a fast path. If they miss, rank by meaning so paraphrases still match.
    if not solution_hits and not injected:
        from semantic import solution_similarities

        scores = solution_similarities(query, solutions)
        solution_hits = collect(scores)

    agent_hits: list[dict] = []
    for agent in catalog.get("agents") or []:
        report = _score_agent(query, req, agent, required_sources)
        if report["score"] < 80 and not report.get("named_source"):
            continue
        agent_hits.append({**agent, **report})
    agent_hits.sort(key=lambda h: h["score"], reverse=True)
    agent_hits = agent_hits[:6]

    gaps = _collect_gaps(req, agent_hits, solution_hits, catalog, required_sources, required_attrs)
    kind = _classify(solution_hits, agent_hits, gaps, use_cases, required_attrs)

    if kind == "none":
        return {"kind": "none", "agents": [], "solutions": [], "gaps": gaps, "useCases": sorted(use_cases)}

    if kind != "existing":
        # Prefer the use-case solution; drop unrelated agents unless they are named sources.
        if solution_hits:
            named = [a for a in agent_hits if a.get("named_source")]
            agent_hits = named[:4]

    return {
        "kind": kind,
        "agents": agent_hits,
        "solutions": solution_hits,
        "gaps": gaps,
        "useCases": sorted(use_cases),
    }


def _score_solution(
    query: str,
    req: dict,
    solution: dict,
    related: list[dict],
    user_cases: set[str],
    sol_cases: set[str],
    required_attrs: list[str],
    required_sources: list[str],
    semantic: float = 0.0,
) -> dict:
    blob = " ".join(
        [
            solution.get("name") or "",
            solution.get("category") or "",
            solution.get("tagline") or "",
            solution.get("description") or "",
            " ".join(solution.get("sourceNames") or []),
            " ".join(solution.get("attributes") or []),
        ]
    ).lower()
    reasons: list[str] = []
    score = 0
    case_overlap = (user_cases - {"generic"}) & (sol_cases - {"generic"})
    if case_overlap:
        score += 70
        reasons.append(f"Covers {solution.get('name')} use case")
    elif semantic >= 0.42:
        score += int(round(semantic * 80))
        reasons.append(f"Same kind of data as {solution.get('name')}")
    else:
        return {"score": 0, "reasons": [], "band": "irrelevant", "attrHits": [], "sourceHits": []}
    if semantic >= 0.42 and case_overlap:
        score += int(round(semantic * 20))

    attr_hits = [attr for attr in required_attrs if _attr_covered(attr, solution, blob)]
    attr_misses = [attr for attr in required_attrs if attr not in attr_hits]
    if required_attrs:
        score += int(40 * (len(attr_hits) / len(required_attrs)))
        for attr in attr_hits[:4]:
            reasons.append(f"Attribute coverage: {attr}")

    source_hits = []
    source_misses = []
    for source in required_sources:
        if _source_on_solution(source, solution, related):
            source_hits.append(source)
            score += 25
            reasons.append(f"Source {source} is listed on this Solution")
        else:
            source_misses.append(source)

    industry = (req.get("industry") or "").lower()
    industry_ok = True
    has_industry_field = "industry" in " ".join(solution.get("attributes") or []).lower()
    if industry == "technology" and "company" in (solution.get("category") or "").lower() and "technolog" not in blob:
        # A company directory with an Industry field can be filtered to tech —
        # that is not a different product. Only reject catalogs that cannot classify industry.
        if has_industry_field:
            score += 8
            reasons.append("Industry is a filterable field on this company directory")
        else:
            industry_ok = False
            reasons.append("General company coverage, not a technology-specific directory")
    elif industry and (industry in blob or industry in (solution.get("category") or "").lower()):
        score += 12
        reasons.append(f"Category {solution.get('category')}")

    geo = req.get("country") or req.get("geography")
    if geo:
        geo_ok = _geo_on_solution(geo, solution, related)
        if geo_ok:
            score += 10

    attr_ratio = (len(attr_hits) / len(required_attrs)) if required_attrs else 1.0
    if not industry_ok and attr_ratio < 0.5:
        return {"score": score, "reasons": reasons, "band": "irrelevant", "attrHits": attr_hits, "sourceHits": source_hits}
    # Alias/spelling misses must not drop a real use-case match (e.g. Specialties vs Speciality).
    if attr_ratio < 0.35 and required_attrs and not source_hits and not case_overlap:
        return {"score": score, "reasons": reasons, "band": "irrelevant", "attrHits": attr_hits, "sourceHits": source_hits}

    band = "full"
    if attr_misses or source_misses or not industry_ok or attr_ratio < 0.35:
        band = "partial"
    return {
        "score": score,
        "reasons": reasons,
        "band": band,
        "attrHits": attr_hits,
        "attrMisses": attr_misses,
        "sourceHits": source_hits,
        "sourceMisses": source_misses,
    }


def _score_agent(query: str, req: dict, agent: dict, required_sources: list[str]) -> dict:
    name = agent.get("name") or ""
    score = 0
    reasons: list[str] = []
    named_source = False
    for source in required_sources:
        if _source_overlaps_agent(source, agent):
            score += 100
            named_source = True
            reasons.append(f"Named source matches Agent {name}")
    if name and re.search(rf"\b{re.escape(name)}\b", query or "", re.I) and len(name) >= 3:
        score += 85
        reasons.append(f"Query names Agent {name}")
    hostname = (agent.get("hostname") or "").lower()
    if hostname and hostname in (query or "").lower():
        score += 85
        reasons.append(f"Domain {hostname}")
    return {"score": score, "reasons": reasons, "named_source": named_source}


def _attr_covered(attr: str, solution: dict, blob: str) -> bool:
    needle = re.sub(r"\s+numbers?$", "", attr.lower().strip()).strip()
    needle = re.sub(r"^hq\s+", "", needle)
    aliases = {
        "pricing": ["price", "pricing", "tariff", "nightly"],
        "phone": ["phone", "contact", "telephone", "direct dial", "phone number"],
        "address": ["address", "street", "hq", "registered office", "hq address"],
        "availability": ["availability", "available", "stock"],
        "reviews": ["review", "rating"],
        "tariffs": ["tariff", "nightly", "price"],
        "doctors": ["doctor", "doctors", "physician", "practitioner", "doctors listed"],
        "doctor": ["doctors", "physician", "practitioner"],
        "specialties": ["specialty", "speciality", "specialities", "specialties", "department"],
        "specialty": ["speciality", "specialities", "specialties", "department"],
        "speciality": ["specialty", "specialties", "specialities"],
        "services": ["service", "services", "department", "departments"],
    }
    keys = {needle, *aliases.get(needle, [])}
    if needle.endswith("ies") and len(needle) > 4:
        keys.add(needle[:-3] + "y")
        keys.add(needle[:-3] + "ity")
    elif needle.endswith("s") and len(needle) > 3:
        keys.add(needle[:-1])
    haystack = " ".join(solution.get("attributes") or []).lower() + " " + blob
    return any(key in haystack for key in keys if len(key) >= 3)


def _source_on_solution(source: str, solution: dict, related: list[dict]) -> bool:
    needle = source.lower()
    names = [n.lower() for n in (solution.get("sourceNames") or [])]
    if any(needle in n or n in needle for n in names):
        return True
    return any(needle in (row.get("name") or "").lower() for row in related)


def _source_overlaps_agent(source: str, agent: dict) -> bool:
    source_lower = source.lower()
    name_lower = (agent.get("name") or "").lower()
    if source_lower == name_lower:
        return True
    if source_lower in name_lower or (len(name_lower) > 4 and name_lower in source_lower):
        return True
    host = (agent.get("hostname") or "").split(".")[0]
    code = re.sub(r"[^a-z0-9]", "", source_lower)
    if host and code and host.startswith(code) and len(code) >= 3:
        return True
    return False


def _geo_on_solution(geo: str, solution: dict, related: list[dict]) -> bool:
    blob = " ".join(
        [solution.get("countriesCovered") or "", solution.get("name") or "", " ".join(s.get("name") or "" for s in related)]
    ).lower()
    wanted = geo.lower()
    if wanted in blob:
        return True
    if wanted == "india":
        return bool(re.search(r"\b(in|india|mca|bse|nse|makemytrip|goibibo|practo)\b", blob))
    return False


def _collect_gaps(
    req: dict,
    agents: list[dict],
    solutions: list[dict],
    catalog: dict,
    required_sources: list[str],
    required_attrs: list[str],
) -> list[dict]:
    gaps: list[dict] = []
    for source in required_sources:
        agent_exists = any(_source_overlaps_agent(source, agent) for agent in catalog.get("agents") or [])
        on_solution = any(_source_on_solution(source, sol, sol.get("relatedSources") or []) for sol in solutions)
        if source.lower() == "company websites":
            gaps.append(
                {
                    "field": "sources",
                    "detail": "Company websites: source coverage needs to be added or validated.",
                }
            )
            continue
        if on_solution and not agent_exists:
            gaps.append(
                {
                    "field": "sources",
                    "detail": f"{source} appears as a related filing/source, but no dedicated Agent is currently indexed.",
                }
            )
        elif not agent_exists and not on_solution:
            gaps.append(
                {
                    "field": "sources",
                    "detail": f"{source} is not present in the Agent or source catalog.",
                }
            )
    if solutions:
        top = solutions[0]
        for attr in top.get("attrMisses") or []:
            gaps.append(
                {
                    "field": "attributes",
                    "detail": f"Requested field “{attr}” is not listed on {top.get('name')}.",
                }
            )
        industry = (req.get("industry") or "").lower()
        hay = " ".join(top.get("attributes") or []).lower() + " " + (top.get("description") or "").lower()
        if (
            industry == "technology"
            and "company" in (top.get("category") or "").lower()
            and "industry" not in hay
            and "technolog" not in hay
        ):
            gaps.append(
                {
                    "field": "industry",
                    "detail": "Existing company-data capabilities are general, not a technology-company directory with the requested contact fields.",
                }
            )
    status = field_status(req)
    if status.get("geography") == "known" and req.get("city"):
        city = req["city"]
        if not any(city.lower() in str(hit).lower() for hit in [*agents, *solutions]):
            gaps.append(
                {
                    "field": "city",
                    "detail": f"City-level coverage for {city} is not explicitly indexed. Country/market matching was used instead.",
                }
            )
    return _unique_gaps(gaps)


def _classify(solutions: list[dict], agents: list[dict], gaps: list[dict], use_cases: set[str], required_attrs: list[str]) -> str:
    if not solutions and not agents:
        return "none"
    top = (solutions[0] if solutions else None) or (agents[0] if agents else None)
    if not top:
        return "none"
    band = top.get("band") or "partial"
    source_gaps = [g for g in gaps if g.get("field") == "sources"]
    attr_gaps = [g for g in gaps if g.get("field") == "attributes"]
    industry_gaps = [g for g in gaps if g.get("field") == "industry"]
    if band == "irrelevant":
        return "none"
    if industry_gaps and (not required_attrs or len(attr_gaps) >= max(1, len(required_attrs) // 2)):
        return "none"
    if band == "full" and not source_gaps and not attr_gaps:
        return "existing"
    if solutions or agents:
        return "partial" if (source_gaps or attr_gaps or industry_gaps or band == "partial") else "existing"
    return "none"


def _unique_gaps(gaps: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for gap in gaps:
        key = gap.get("detail") or ""
        if key in seen:
            continue
        seen.add(key)
        out.append(gap)
    return out

