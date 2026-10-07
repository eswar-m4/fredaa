from __future__ import annotations

import re

STOP = {
    "the", "and", "for", "with", "from", "that", "this", "need", "want", "show",
    "list", "data", "in", "of", "a", "an", "to", "me", "i", "please",
    "information", "services", "details", "available", "refreshed", "every",
}

FAMILY_PATTERNS = [
    ("healthcare", re.compile(r"\b(hospital|hospitals|clinic|clinics|doctor|doctors|physician|healthcare|specialt(?:y|ies)|nabh|practo)\b", re.I)),
    ("hospitality", re.compile(r"\b(hotel|hotels|resort|restaurant|restaurants|venue|venues|hospitality|tariff|nightly)\b", re.I)),
    ("travel", re.compile(r"\b(flight|flights|airlines?|ota|booking\.com|expedia|kayak|cruise)\b", re.I)),
    ("education", re.compile(r"\b(school districts?|public schools?|k-12|teachers?|nces)\b", re.I)),
    ("financial", re.compile(r"\b(annual report|financial statement|filings?|balance sheet|bse|nse|edgar)\b", re.I)),
    ("product", re.compile(r"\b(product|sku|ecommerce|e-commerce|marketplace|amazon|walmart|asin)\b", re.I)),
    ("automotive", re.compile(r"\b(dealer|dealership|vin|car rental|automotive|used car)\b", re.I)),
    ("firmographic", re.compile(r"\b(firmographic|firmographics|company profiles?|company data|b2b companies|headcount|technograph|tech(?:nology)? companies|list of (?:tech(?:nology)? )?companies)\b", re.I)),
    ("registry", re.compile(r"\b(registry|gst|gstin|mca|companies house|lei|beneficial owner|incorporation)\b", re.I)),
    ("contacts", re.compile(r"\b(people|contacts|emails?|decision[-\s]?makers?)\b", re.I)),
]

FAMILY_HINTS = {
    "healthcare": ["hospital", "clinic", "doctor", "healthcare", "practo"],
    "hospitality": ["hotel", "hospitality", "restaurant", "venue", "tariff"],
    "travel": ["flight", "airline", "travel", "hospitality"],
    "education": ["school", "district", "teacher", "k-12", "education", "nces"],
    "financial": ["financial", "filing", "annual", "bse", "nse", "statement"],
    "product": ["amazon", "ecommerce", "product", "marketplace", "price"],
    "automotive": ["automotive", "dealer", "vehicle", "car"],
    "firmographic": ["firmographic", "firmographics", "company profile", "b2b", "headcount"],
    "registry": ["registry", "mca", "companies house", "lei", "incorporation"],
    "contacts": ["contact", "people", "email", "linkedin"],
}

SYNONYMS = {
    "hotels": ["hotel", "hospitality", "venue", "tariff"],
    "hotel": ["hotels", "hospitality", "tariff"],
    "pricing": ["price", "prices", "tariff", "nightly"],
    "price": ["pricing", "prices", "tariff"],
    "hospitals": ["hospital", "healthcare", "clinic", "doctor"],
    "hospital": ["hospitals", "healthcare", "clinic", "doctor"],
    "doctors": ["doctor", "physician", "specialty"],
    "specialties": ["specialty", "speciality", "doctor"],
    "flights": ["flight", "airline", "travel"],
    "flight": ["flights", "airline", "travel"],
    "amazon": ["marketplace", "ecommerce", "product"],
    "reports": ["filings", "annual", "financial", "statement"],
    "annual": ["filings", "reports", "financial"],
    "nse": ["exchange", "filings", "bse"],
    "bse": ["exchange", "filings", "nse"],
    "firmographic": ["firmographics"],
    "firmographics": ["firmographic"],
}

COUNTRY_ALIASES = {
    "India": ["india", "indian", "bharat"],
    "US": ["us", "usa", "united states", "america", "american"],
    "UK": ["uk", "united kingdom", "britain", "british", "england"],
    "Australia": ["australia", "australian"],
    "Canada": ["canada", "canadian"],
    "Germany": ["germany", "german"],
    "Singapore": ["singapore"],
    "UAE": ["uae", "dubai"],
}


def tokens(text: str) -> set[str]:
    parts = re.split(r"[^a-z0-9+]+", text.lower())
    base = [p for p in parts if len(p) > 2 and p not in STOP]
    extra: list[str] = []
    for part in base:
        extra.extend(SYNONYMS.get(part, []))
    return set(base + extra)


def detect_country(text: str) -> str | None:
    lower = text.lower()
    for canonical, aliases in COUNTRY_ALIASES.items():
        for alias in aliases:
            if re.search(rf"\b{re.escape(alias)}\b", lower):
                return canonical
    return None


def detect_family(text: str) -> str | None:
    for family, pattern in FAMILY_PATTERNS:
        if pattern.search(text):
            return family
    return None


def _family_boost(family: str | None, blob: str) -> int:
    if not family:
        return 0
    hints = FAMILY_HINTS.get(family) or []
    lower = blob.lower()
    if any(hint in lower for hint in hints):
        return 40
    return 0


def retrieve(query: str, catalog: dict, limit_agents: int = 18, limit_solutions: int = 8) -> dict:
    q = query.strip()
    q_tokens = tokens(q)
    country = detect_country(q)
    family = detect_family(q)
    agents = []
    for agent in catalog["agents"]:
        blob = " ".join(
            [
                agent["name"],
                agent["category"],
                agent["industry"],
                agent["dataType"],
                agent["description"],
                agent["country"],
                agent["hostname"],
            ]
        )
        score = 0
        reasons: list[str] = []
        name = agent["name"]
        if re.search(rf"\b{re.escape(name)}\b", q, re.I) and len(name) >= 3:
            score += 90
            reasons.append(f"Query names Agent {name}")
        if agent["hostname"] and agent["hostname"] in q.lower():
            score += 85
            reasons.append(f"Domain {agent['hostname']}")
        overlap = q_tokens & tokens(blob)
        topical = len(overlap) * 7
        score += topical
        family_pts = _family_boost(family, blob)
        if family_pts and (topical or score >= 90):
            score += family_pts
            reasons.append(f"Intent family {family}")
        if country and country.lower() in agent["country"].lower() and (topical or family_pts or score >= 90):
            score += 20
            reasons.append(f"Geography {agent['country']}")
        if "amazon" in q.lower() and name.lower() == "amazon":
            score += 40
        if family and not family_pts and score < 90:
            continue
        if score >= 28:
            hit = {**agent, "score": score, "reasons": reasons or [f"Overlap with {agent['dataType'] or agent['category']}"]}
            agents.append(hit)
    agents.sort(key=lambda h: h["score"], reverse=True)
    agents = _cut(agents, 28)
    if country:
        local = [a for a in agents if country.lower() in (a.get("country") or "").lower()]
        if local:
            agents = local

    solutions = []
    for solution in catalog["solutions"]:
        related = [s for s in catalog["sources"] if s["solutionId"] == solution["id"]]
        blob = " ".join(
            [
                solution["name"],
                solution["category"],
                solution["tagline"],
                solution["description"],
                " ".join(solution["sourceNames"]),
                " ".join(solution["attributes"][:12]),
            ]
        )
        score = len(q_tokens & tokens(blob)) * 6
        reasons = []
        name = solution["name"]
        sol_id = solution["id"]
        q_lower = q.lower()
        if sol_id.lower() in q_lower:
            score += 90
            reasons.append(f"Query names Solution {name}")
        elif len(name) >= 3 and name.lower() in q_lower:
            score += 90
            reasons.append(f"Query names Solution {name}")
        else:
            raw_name = {p for p in re.split(r"[^a-z0-9+]+", name.lower()) if len(p) > 2 and p not in STOP}
            q_raw = {p for p in re.split(r"[^a-z0-9+]+", q_lower) if len(p) > 2 and p not in STOP}
            distinctive = {t for t in (raw_name & q_raw) if len(t) >= 8}
            if distinctive:
                score += 90
                reasons.append(f"Query names Solution {name}")
        family_pts = _family_boost(family, blob)
        if family_pts:
            score += family_pts
            reasons.append(f"Intent family {family}")
        if country:
            region_hits = []
            for src in related:
                region = (src.get("region") or "").upper()
                src_name = src.get("name") or ""
                india_source = bool(re.search(r"makemytrip|goibibo|practo|mca|bse|nse|policybazaar|fssai", src_name, re.I))
                if country == "India" and (region in {"IN", "INDIA"} or india_source):
                    region_hits.append(src)
                elif country.lower() in src_name.lower():
                    region_hits.append(src)
            if region_hits:
                score += 22
                reasons.append(f"{country} sources: " + ", ".join(s["name"] for s in region_hits[:4]))
        if score >= 22:
            solutions.append(
                {
                    **solution,
                    "score": score,
                    "reasons": reasons or [f"Use-case overlap with {solution['name']}"],
                    "relatedSources": related,
                }
            )
    solutions.sort(key=lambda h: h["score"], reverse=True)
    solutions = _cut(solutions, 24)

    named_solution = solutions and any(
        "Query names Solution" in (reason or "")
        for reason in (solutions[0].get("reasons") or [])
    )
    if named_solution:
        agents = [a for a in agents if a["score"] >= 80]

    return {
        "country": country,
        "family": family or "generic",
        "agents": agents[:limit_agents],
        "solutions": solutions[:limit_solutions],
        "overview": catalog["overview"],
        "sheets": catalog["sheets"],
        "generated": catalog["generated"],
        "agentsByCategory": catalog["agentsByCategory"],
        "solutionsByCategory": catalog["solutionsByCategory"],
        "allSolutions": catalog["solutions"],
        "agentCount": len(catalog["agents"]),
        "solutionCount": len(catalog["solutions"]),
        "sourceCount": len(catalog["sources"]),
    }


def _cut(hits: list[dict], min_keep: int) -> list[dict]:
    if not hits:
        return []
    top = hits[0]["score"]
    floor = max(min_keep, int(top * 0.85))
    return [h for h in hits if h["score"] >= floor]


def compact_context(retrieved: dict) -> str:
    has_matches = bool(retrieved.get("solutions") or retrieved.get("agents"))
    lines = [
        f"Catalog generated: {retrieved.get('generated') or 'unknown'}",
        f"Totals: {retrieved['agentCount']} agents, {retrieved['solutionCount']} solutions, {retrieved['sourceCount']} source rows.",
    ]
    if retrieved.get("solutions"):
        lines.append("MATCHED SOLUTIONS (existing packaged capability — recommend these; a Solution is enough, no dedicated Agent is required):")
        for sol in retrieved["solutions"]:
            src = ", ".join(s["name"] for s in sol.get("relatedSources", [])[:8])
            lines.append(
                f"- [{sol['id']}] {sol['name']} | {sol['category']} | {sol['tagline']} | "
                f"coverage {sol['coverage']}% (this Solution) | refresh {sol['refreshCadence']} | "
                f"sources ({sol['sourceCount']}): {'; '.join(sol['sourceNames'][:8])} | "
                f"attrs: {'; '.join(sol['attributes'][:15])} | related sources: {src}"
            )
    if retrieved.get("agents"):
        lines.append("Retrieved Agents (recommend only from this list):")
        for agent in retrieved["agents"]:
            lines.append(
                f"- [{agent['id']}] {agent['name']} | {agent['country']} | {agent['category']} | "
                f"{agent['dataType']} | {agent['description']} | {agent['sourceUrl']} | complexity {agent['complexity']}"
            )
    elif has_matches:
        lines.append("Retrieved Agents: none — that does not mean the requirement is uncovered if a Solution matched.")
    if not has_matches:
        lines.append("Overview:")
        for stat in retrieved["overview"]:
            lines.append(f"- {stat['label']}: {stat['value']}")
        lines.append("Sheets:")
        for sheet in retrieved["sheets"]:
            lines.append(f"- {sheet['name']}: {sheet['contents']}")
        lines.append("All packaged solutions (complete list):")
        for sol in retrieved["allSolutions"]:
            lines.append(
                f"- [{sol['id']}] {sol['name']} | {sol['category']} | {sol['tagline']} | "
                f"coverage {sol['coverage']}% (this Solution) | refresh {sol['refreshCadence']} | "
                f"sources ({sol['sourceCount']}): {'; '.join(sol['sourceNames'][:8])}"
            )
        lines.append("Retrieved Agents (recommend only from this list):")
        lines.append("- none")
        lines.append("Retrieved Solutions with extra detail:")
        lines.append("- none beyond the full list above")
    return "\n".join(lines)
