from __future__ import annotations

import re

from urllib.parse import urlencode

from catalog import load_catalog
from extract_req import classify_intent, extract_requirement, scope_summary
from jobs import create_job, list_jobs
from llm import complete_json, compose_scope_question, llm_config
from match_scope import match_capabilities
from questions import (
    COMPANY_LIST_SOURCE_CHOICES,
    COMPANY_TYPE_CHOICES,
    LIST_SIZE_CHOICES,
    SIZE_FILTER_CHOICES,
    apply_answer,
    coerce_attribute_choices,
    family_for,
    next_question,
    synthesize_question,
)
from retrieve import compact_context, retrieve

# "Use this capability" opens the matching playbook in the live Freda product.
# Genesis /any-site and /site-specific redirect these relative paths to Mythili-freda.
USE_CAPABILITY_PATH = "/any-site"
USE_AGENT_PATH = "/site-specific"

BUILD_NEW_PHRASE = re.compile(
    r"^\s*(build a new requirement|build new|new requirement|new dataset)\s*$",
    re.I,
)
SUBMIT_PHRASE = re.compile(r"\b(submit( request)?|create ticket|create job|send to onboarding)\b", re.I)
EDIT_PHRASE = re.compile(r"^\s*(edit( scope)?|revise|change|make changes)\s*$", re.I)
EDIT_TARGET = "__edit_target"
EDIT_FIELDS: list[tuple[str, str]] = [
    ("entityType", "Entity"),
    ("category", "Category"),
    ("subIndustry", "Sub-category"),
    ("extras.reportKind", "Report type"),
    ("geography", "Geography / market"),
    ("attributes", "Required data"),
    ("sources", "Sources"),
    ("extras.companyType", "Company type"),
    ("extras.sizeFilter", "Size filter"),
    ("extras.listSize", "List size"),
    ("extras.scope", "Scope / filters"),
    ("frequency", "Frequency"),
    ("historical", "Historical data"),
]

CATALOG_QUESTION = re.compile(
    r"\b(how many\s+(agents|solutions)|what sheets|which sheets|sheet names|"
    r"list the (solution|agent)|solution catalogu?e|agent catalogu?e|"
    r"catalog contents|what's in the catalog|overview of the catalog|"
    r"agents by category|solutions by category)\b",
    re.I,
)

def _dataset_setup_href(solution_id: str | None = None) -> str:
    if solution_id:
        return f"{USE_CAPABILITY_PATH}?{urlencode({'dataset': solution_id})}"
    return USE_CAPABILITY_PATH


def _agent_href(agent_id: str | None = None) -> str:
    if agent_id:
        return f"{USE_AGENT_PATH}?{urlencode({'agent': agent_id})}"
    return USE_AGENT_PATH


def _use_existing_options(
    agent_hits: list | None,
    solution_hits: list | None,
    use_label: str,
) -> list[dict]:
    solutions = [item for item in (solution_hits or []) if item.get("id")]
    agents = [item for item in (agent_hits or []) if item.get("id")]
    if len(solutions) == 1:
        return [{"id": "use_existing", "label": use_label, "href": _dataset_setup_href(solutions[0]["id"])}]
    if len(solutions) > 1:
        return [
            {
                "id": "use_existing",
                "label": f"Use {item.get('name') or 'this capability'}",
                "href": _dataset_setup_href(item["id"]),
            }
            for item in solutions
        ]
    if len(agents) == 1:
        return [{"id": "use_existing", "label": use_label, "href": _agent_href(agents[0]["id"])}]
    if len(agents) > 1:
        return [
            {
                "id": "use_existing",
                "label": f"Use {item.get('name') or 'this capability'}",
                "href": _agent_href(item["id"]),
            }
            for item in agents
        ]
    return [{"id": "use_existing", "label": use_label, "href": _dataset_setup_href()}]


EMPTY_REQUIREMENT = {
    "sources": [],
    "sourceUrls": [],
    "attributes": [],
    "extras": {},
}

INITIAL_STATE = {
    "phase": "idle",
    "requirement": dict(EMPTY_REQUIREMENT),
    "askedFields": [],
    "family": "generic",
    "matchKind": None,
    "agentHits": [],
    "solutionHits": [],
    "gaps": [],
    "suggestedSources": [],
    "buildNew": False,
    "scopeMode": None,
    "answersLog": [],
    "pendingField": None,
    "pendingPrompt": None,
}


def _catalog_index(catalog: dict) -> tuple[dict, dict]:
    return (
        {a["id"]: a for a in catalog["agents"]},
        {s["id"]: s for s in catalog["solutions"]},
    )


def _hydrate_agents(ids: list[str], retrieved_agents: list[dict], by_id: dict) -> list[dict]:
    hits = []
    seen = set()
    for item in retrieved_agents:
        by_id.setdefault(item["id"], item)
    for agent_id in ids:
        agent_id = str(agent_id)
        if agent_id in seen or agent_id not in by_id:
            continue
        seen.add(agent_id)
        agent = by_id[agent_id]
        hits.append(
            {
                **{k: agent.get(k, "") for k in (
                    "id", "name", "sourceUrl", "category", "industry", "country",
                    "dataType", "description", "complexity", "datapoints", "project", "estimatedRecords",
                )},
                "score": agent.get("score", 0),
                "reasons": agent.get("reasons", []),
            }
        )
    return hits[:6]


def _hydrate_solutions(ids: list[str], retrieved: dict, by_id: dict, catalog: dict) -> list[dict]:
    hits = []
    seen = set()
    retrieved_map = {s["id"]: s for s in retrieved["solutions"]}
    for sol_id in ids:
        if sol_id in seen or sol_id not in by_id:
            continue
        seen.add(sol_id)
        sol = {**by_id[sol_id], **retrieved_map.get(sol_id, {})}
        related = sol.get("relatedSources") or [s for s in catalog["sources"] if s["solutionId"] == sol_id]
        hits.append(
            {
                "id": sol["id"],
                "name": sol["name"],
                "category": sol["category"],
                "tagline": sol["tagline"],
                "description": sol["description"],
                "coverage": sol["coverage"],
                "accuracy": sol["accuracy"],
                "countriesCovered": sol["countriesCovered"],
                "refreshCadence": sol["refreshCadence"],
                "refreshOptions": sol.get("refreshOptions") or [],
                "sourceCount": sol["sourceCount"],
                "sourceNames": sol.get("sourceNames") or [],
                "attributeCount": sol["attributeCount"],
                "attributes": sol.get("attributes") or [],
                "records": sol["records"],
                "score": sol.get("score", 0),
                "reasons": sol.get("reasons", []),
                "relatedSources": related,
            }
        )
    return hits[:4]


def _merge_requirement(prior: dict, patch: dict | None) -> dict:
    next_req = {
        **EMPTY_REQUIREMENT,
        **{k: v for k, v in (prior or {}).items() if v is not None},
        "sources": list((prior or {}).get("sources") or []),
        "sourceUrls": list((prior or {}).get("sourceUrls") or []),
        "attributes": list((prior or {}).get("attributes") or []),
        "extras": dict((prior or {}).get("extras") or {}),
    }
    if not patch:
        return next_req
    for key, value in patch.items():
        if value in (None, "", []):
            continue
        if key in {"sources", "sourceUrls", "attributes"} and isinstance(value, list):
            merged = list(next_req.get(key) or [])
            for item in value:
                if item and item not in merged:
                    merged.append(item)
            next_req[key] = merged
        elif key == "extras" and isinstance(value, dict):
            next_req["extras"] = {**next_req["extras"], **value}
        else:
            next_req[key] = value
    return next_req


def _summary(req: dict) -> dict[str, str]:
    return scope_summary(req)


def _estimate(state: dict) -> dict:
    solution = (state.get("solutionHits") or [None])[0]
    agent = (state.get("agentHits") or [None])[0]
    req = state.get("requirement") or {}
    return {
        "volume": (solution or {}).get("records") or (agent or {}).get("estimatedRecords") or "To be confirmed during onboarding",
        "timeline": "Ready to schedule on the existing capability." if state.get("matchKind") == "existing" else "About 1–2 weeks to extend or onboard, pending Solutions review.",
        "sources": req.get("sources") or (solution or {}).get("sourceNames") or ["To be confirmed from the catalog"],
        "attributes": req.get("attributes") or ((solution or {}).get("attributes") or [])[:8] or ["To be confirmed"],
        "refresh": req.get("frequency") or (solution or {}).get("refreshCadence") or "To be confirmed",
        "geography": req.get("geography") or req.get("country") or "Not specified",
        "assumptions": [
            "Estimates use catalog metadata for the matched capability only — not platform-wide coverage or accuracy.",
            "Pricing is outside this Ask Freda flow.",
        ],
        "complexity": (agent or {}).get("complexity") or "Medium",
    }


def _capability_card(match_kind: str | None, agent_hits: list, solution_hits: list, req: dict | None = None) -> dict:
    existing = match_kind == "existing"
    return {
        "type": "capabilities",
        "title": "Existing capability found" if existing else "Existing capability — partial match",
        "body": "Reuse this rather than building a duplicate." if existing else "This capability covers the data type, but not your exact scope.",
        "agents": agent_hits,
        "solutions": solution_hits,
        "summary": scope_summary(req) if req else None,
    }


def _path_card(
    match_kind: str | None = None,
    agent_hits: list | None = None,
    solution_hits: list | None = None,
    gaps: list | None = None,
) -> dict:
    source_gap = any((gap.get("field") or "").startswith("source") for gap in (gaps or []))
    if match_kind == "partial" and source_gap:
        use_label = "Use existing capability without the missing sources"
        expand_label = "Extend existing capability"
        new_label = "Create a new multi-source requirement"
    else:
        use_label = "Use this capability"
        expand_label = "Customize / Extend"
        new_label = "Create new scope"
    return {
        "type": "path_options",
        "title": "How do you want to proceed?",
        "options": [
            *_use_existing_options(agent_hits, solution_hits, use_label),
            {"id": "expand", "label": expand_label},
            {"id": "build_new", "label": new_label},
        ],
    }


def _metadata_cards(message: str, catalog: dict) -> list[dict]:
    q = (message or "").lower()
    if "sheet" in q:
        return [
            {
                "type": "metadata",
                "title": "Catalog sheets",
                "metadata": {
                    "kind": "sheets",
                    "rows": [
                        {"label": "Agents Catalog", "value": f"{len(catalog['agents'])} extraction agents"},
                        {"label": "Solutions Catalog", "value": f"{len(catalog['solutions'])} packaged data solutions"},
                        {"label": "Solution Sources", "value": f"{len(catalog['sources'])} source rows"},
                        *[{"label": s["name"], "value": s["contents"]} for s in catalog["sheets"]],
                    ],
                },
            }
        ]
    if "solution" in q or "catalogue" in q:
        return [
            {
                "type": "metadata",
                "title": "Solutions catalogue",
                "metadata": {
                    "kind": "solutions",
                    "rows": [
                        {
                            "label": f["name"],
                            "value": f"{f['count']} solution" + ("" if f["count"] == 1 else "s"),
                        }
                        for f in catalog["solutionsByCategory"]
                    ],
                    "solutions": catalog["solutions"],
                },
            }
        ]
    if "agent" in q:
        return [
            {
                "type": "metadata",
                "title": "Agents by category",
                "metadata": {
                    "kind": "facets",
                    "rows": [{"label": f["name"], "value": str(f["count"])} for f in catalog["agentsByCategory"]],
                },
            }
        ]
    return [
        {
            "type": "metadata",
            "title": "Catalog overview",
            "metadata": {
                "kind": "overview",
                "rows": [
                    *[{"label": s["label"], "value": s["value"]} for s in catalog["overview"]],
                    {"label": "Generated", "value": catalog["generated"] or "Not specified"},
                ],
            },
        }
    ]


def _metadata_text(message: str, catalog: dict) -> str:
    q = (message or "").lower()
    if "sheet" in q:
        return (
            f"The catalog workbook has Overview plus Agents, Solutions, Sources, and facet sheets. "
            f"There are {len(catalog['agents'])} Agents, {len(catalog['solutions'])} Solutions, "
            f"and {len(catalog['sources'])} source rows."
        )
    if "solution" in q or "catalogue" in q:
        return (
            f"There are {len(catalog['solutions'])} packaged Solutions across "
            f"{len(catalog['solutionsByCategory'])} categories."
        )
    if "agent" in q:
        return f"The Agent catalog currently has {len(catalog['agents'])} extraction agents."
    bits = [f"{row['label']}: {row['value']}" for row in catalog["overview"][:8]]
    return "Catalog overview:\n" + "\n".join(bits)


def _hits_from_retrieve(retrieved: dict, catalog: dict, agents_by_id: dict, solutions_by_id: dict) -> tuple[list, list]:
    sol_ids = [s["id"] for s in retrieved.get("solutions") or []][:3]
    solution_hits = _hydrate_solutions(sol_ids, retrieved, solutions_by_id, catalog)
    if not solution_hits and retrieved.get("solutions"):
        solution_hits = retrieved["solutions"][:3]
    # Prefer the packaged Solution; do not list unrelated Agents beside it.
    if solution_hits:
        return [], solution_hits
    agent_ids = [a["id"] for a in retrieved.get("agents") or []][:3]
    agent_hits = _hydrate_agents(agent_ids, retrieved.get("agents") or [], agents_by_id)
    if not agent_hits and retrieved.get("agents"):
        agent_hits = retrieved["agents"][:3]
    return agent_hits, solution_hits


def _catalog_match_reply(
    message: str,
    state: dict,
    catalog: dict,
) -> dict | None:
    requirement = extract_requirement(message or "", state.get("requirement"))
    matched = match_capabilities(message or "", requirement, catalog)
    agent_hits = matched.get("agents") or []
    solution_hits = matched.get("solutions") or []
    gaps = matched.get("gaps") or []
    match_kind = matched.get("kind") or "none"
    if match_kind == "none" or (not agent_hits and not solution_hits):
        return None
    next_state = {
        **state,
        "phase": "awaiting_path",
        "requirement": _merge_requirement(state.get("requirement"), requirement),
        "matchKind": match_kind,
        "family": family_for(message or "", state.get("family")),
        "agentHits": agent_hits,
        "solutionHits": solution_hits,
        "gaps": gaps,
        "lastUserMessage": message or state.get("lastUserMessage"),
        "buildNew": False,
    }
    cards: list[dict] = [_capability_card(match_kind, agent_hits, solution_hits, next_state["requirement"])]
    if gaps:
        cards.append({"type": "gaps", "title": "Gaps versus your requirement", "gaps": gaps})
    cards.append(_path_card(match_kind, agent_hits, solution_hits, gaps))
    return {
        "text": _strip_catalog_ids(_match_text(next_state["requirement"], agent_hits, solution_hits, match_kind, gaps)),
        "state": next_state,
        "cards": _public_cards(cards),
        "llm": {"provider": "none", "used": False},
    }


def _strip_catalog_ids(text: str) -> str:
    cleaned = re.sub(r"\[(?:ds-[a-z0-9-]+|\d{1,4})\]", "", text, flags=re.I)
    cleaned = re.sub(
        r"\b(?:agent|solution|source)\s+ids?\s*[:=]?\s*(?:ds-[a-z0-9-]+|\d+)\b",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(r"\bds-[a-z0-9]+(?:-[a-z0-9]+)*\b", "", cleaned, flags=re.I)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r" +\n", "\n", cleaned)
    cleaned = re.sub(r"\s+[—–-]\s+(?=[A-Z])", " ", cleaned)
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
    cleaned = re.sub(r"^[—–\-:\s]+", "", cleaned, flags=re.M)
    cleaned = re.sub(r":\s+", ": ", cleaned)
    cleaned = re.sub(r"\b(?:and|,)\s*([.!?])", r"\1", cleaned)
    return cleaned.strip()


def _public_cards(cards: list[dict]) -> list[dict]:
    out: list[dict] = []
    for card in cards:
        next_card = dict(card)
        if next_card.get("body"):
            next_card["body"] = _strip_catalog_ids(str(next_card["body"]))
        if next_card.get("questions"):
            next_card["questions"] = [_strip_catalog_ids(q) for q in next_card["questions"]]
        if next_card.get("gaps"):
            next_card["gaps"] = [
                {**gap, "detail": _strip_catalog_ids(gap.get("detail") or "")} for gap in next_card["gaps"]
            ]
        if next_card.get("summary"):
            next_card["summary"] = {
                key: _strip_catalog_ids(str(value)) for key, value in next_card["summary"].items()
            }
        out.append(next_card)
    return out


def _match_text(req: dict, agent_hits: list, solution_hits: list, match_kind: str, gaps: list) -> str:
    names = [s.get("name") for s in solution_hits[:2] if s.get("name")]
    names += [a.get("name") for a in agent_hits[:2] if a.get("name")]
    named = ", ".join(dict.fromkeys(names)) or "this catalog capability"
    understood = _understood_line(req)
    if match_kind == "partial":
        gap_text = " ".join(g.get("detail") or "" for g in gaps[:3]).strip()
        return (
            f"{understood} I found an existing capability — {named} — that covers this data type, "
            f"but your requested scope is not fully available. {gap_text} "
            "You can use the existing capability without the missing pieces, extend it, or create a new scope."
        )
    details = []
    if solution_hits:
        top = solution_hits[0]
        if top.get("tagline"):
            details.append(top["tagline"])
        if top.get("refreshCadence"):
            details.append(f"Default refresh: {top['refreshCadence']}")
        if top.get("sourceCount"):
            details.append(f"Sources: {top['sourceCount']}")
    extra = " ".join(details)
    extra = f" {extra}." if extra else ""
    return (
        f"{understood} Existing capability found. {named} already supports this type of data.{extra} "
        "Your request is already substantially covered. What would you like to do?"
    )


def _understood_line(req: dict) -> str:
    entity = req.get("entityType") or "this data"
    geo = req.get("geography") or req.get("country")
    attrs = ", ".join(req.get("attributes") or [])
    bits = [f"I understand you’re looking for {entity.lower()}"]
    if geo:
        bits.append(f"in {geo}")
    if attrs:
        bits.append(f"with {attrs.lower()}")
    return " ".join(bits) + "."


def _recommend_text(agent_hits: list, solution_hits: list) -> str:
    names = [s.get("name") for s in solution_hits[:2] if s.get("name")]
    names += [a.get("name") for a in agent_hits[:2] if a.get("name")]
    named = ", ".join(dict.fromkeys(names)) or "this catalog capability"
    return (
        f"Existing capability found. {named} already covers this requirement, "
        "so you do not need to build a dedicated Agent. "
        "You can use this capability, customize it, or create a new scope."
    )


def _original_request(state: dict, message: str) -> str:
    last = (state.get("lastUserMessage") or "").strip()
    if last and not BUILD_NEW_PHRASE.search(last):
        return last
    text = (message or "").strip()
    if text and not BUILD_NEW_PHRASE.search(text):
        return text
    return last or text


def _known_facts(req: dict) -> dict[str, str]:
    extras = req.get("extras") or {}
    facts: dict[str, str] = {}
    if req.get("objective"):
        facts["Original request"] = req["objective"]
    if req.get("entityType"):
        facts["Entity"] = req["entityType"]
    if req.get("category"):
        facts["Category"] = req["category"]
    if req.get("subIndustry"):
        facts["Segment"] = req["subIndustry"]
    if req.get("industry") and req.get("industry") not in {req.get("category"), "Company"}:
        facts["Industry"] = req["industry"]
    dtype = req.get("dataType") or extras.get("dataType")
    if dtype:
        facts["Data"] = dtype
    geo = req.get("geography") or req.get("country") or req.get("city")
    if geo:
        facts["Market"] = geo
    attrs = req.get("attributes") or []
    if attrs:
        facts["Fields"] = ", ".join(attrs)
    if req.get("frequency"):
        facts["Frequency"] = req["frequency"]
    if extras.get("volume") or extras.get("rankingHint"):
        facts["Universe"] = extras.get("rankingHint") or extras.get("volume")
    if extras.get("companyType"):
        facts["Company type"] = extras["companyType"]
    if extras.get("sizeFilter"):
        facts["Size filter"] = extras["sizeFilter"]
    if extras.get("listSize"):
        facts["List size"] = extras["listSize"]
    if extras.get("scope"):
        facts["Coverage"] = extras["scope"]
    if extras.get("rankingMethod"):
        facts["Ranking"] = extras["rankingMethod"]
    sources = req.get("sources") or []
    if sources:
        facts["Sources"] = ", ".join(sources)
    elif extras.get("sourcesDeferred") == "true":
        facts["Sources"] = "Public / catalog sources"
    return facts


def _review_summary(req: dict, log: list[dict]) -> dict[str, str]:
    return scope_summary(req)


def _field_value(req: dict, field: str) -> str:
    extras = req.get("extras") or {}
    if field == "geography":
        return req.get("geography") or req.get("country") or req.get("city") or ""
    if field == "attributes":
        return ", ".join(req.get("attributes") or [])
    if field == "sources":
        if req.get("sources"):
            return ", ".join(req["sources"])
        if extras.get("sourcesDeferred") == "true":
            return "Suitable public / catalog sources"
        return ""
    if field.startswith("extras."):
        return str(extras.get(field.split(".", 1)[1]) or "")
    return str(req.get(field) or "")


def _edit_choices(req: dict) -> list[str]:
    choices: list[str] = []
    for field, label in EDIT_FIELDS:
        current = _field_value(req, field)
        if current:
            choices.append(f"{label} (currently {current})")
        elif field in {"entityType", "geography", "attributes", "sources", "frequency"}:
            choices.append(label)
    if "Something else" not in choices:
        choices.append("Something else")
    return choices


def _edit_field_from_answer(text: str) -> str | None:
    lower = (text or "").strip().lower()
    if not lower or lower in {"something else", "other", "something else."}:
        return None
    for field, label in EDIT_FIELDS:
        if lower == label.lower() or lower.startswith(f"{label.lower()} ("):
            return field
        if lower == field.lower() or lower == field.split(".")[-1].lower():
            return field
    if re.search(r"\b(geograph|market|country|city)\b", lower):
        return "geography"
    if re.search(r"\b(attribute|fields?|required data|outputs?)\b", lower):
        return "attributes"
    if re.search(r"\bsources?\b", lower):
        return "sources"
    if re.search(r"\b(frequen|refresh|cadence)\b", lower):
        return "frequency"
    if re.search(r"\b(histor)", lower):
        return "historical"
    if re.search(r"\b(categor|star|segment|industry)\b", lower):
        return "category"
    if re.search(r"\b(entity|type)\b", lower):
        return "entityType"
    if re.search(r"\b(scope|filter|inclusion)\b", lower):
        return "extras.scope"
    if re.search(r"\breport\b", lower):
        return "extras.reportKind"
    return None


def _confirming_reply(state: dict, req: dict, log: list[dict], family: str, llm_meta: dict | None = None) -> dict:
    next_state = {
        **state,
        "phase": "confirming",
        "buildNew": True,
        "requirement": req,
        "family": family,
        "answersLog": log,
        "pendingField": None,
        "pendingPrompt": None,
        "pendingChoices": [],
        "pendingMulti": False,
    }
    return {
        "text": "Here is the updated requirement. Review it and submit the request, or edit another field.",
        "state": next_state,
        "cards": _public_cards(
            [
                {
                    "type": "summary",
                    "title": "Review your new requirement",
                    "summary": _review_summary(req, log),
                    "options": [
                        {"id": "revise", "label": "Edit scope"},
                        {"id": "submit_job", "label": "Submit request"},
                    ],
                }
            ]
        ),
        "llm": llm_meta or {"provider": "none", "used": False, "configured": llm_config() is not None},
    }


def _ask_what_to_edit(state: dict, req: dict, family: str) -> dict:
    choices = _edit_choices(req)
    question = {
        "field": EDIT_TARGET,
        "prompt": "What would you like to change?",
        "choices": choices,
        "multi": False,
        "allowOther": True,
    }
    return {
        "text": "What would you like to change in this requirement? Pick a field, or type the change.",
        "state": {
            **state,
            "phase": "revising",
            "buildNew": True,
            "requirement": req,
            "family": family,
            "pendingField": EDIT_TARGET,
            "pendingPrompt": question["prompt"],
            "pendingChoices": choices,
            "pendingMulti": False,
        },
        "cards": _public_cards(
            [
                {
                    "type": "summary",
                    "title": "Current scope",
                    "summary": _review_summary(req, state.get("answersLog") or []),
                },
                _choice_card(question),
            ]
        ),
        "llm": {"provider": "none", "used": False, "configured": llm_config() is not None},
    }


def _llm_meta(provider: str) -> dict:
    if provider != "none":
        return {"provider": provider, "used": True, "configured": True}
    return {"provider": "none", "used": False, "configured": llm_config() is not None}


def _revise_field_question(field: str, req: dict, family: str, state: dict, catalog: dict | None) -> tuple[dict, dict]:
    """Same composer as gathering. The fixed choices are only the fallback."""
    question = synthesize_question(
        field, req, family, catalog=catalog, solution_hits=state.get("solutionHits") or []
    )
    question, provider = _compose_question(question, req, family, state, editing=True)
    return _shape_question(question, req), _llm_meta(provider)


def _handle_revise(message: str, state: dict, action: str | None, catalog: dict | None = None) -> dict:
    req = _merge_requirement(state.get("requirement"), None)
    family = state.get("family") or family_for(state.get("lastUserMessage") or "", "generic")
    pending = state.get("pendingField")
    answer = (message or "").strip()
    editable = {EDIT_TARGET, "sourceNames", *(field for field, _ in EDIT_FIELDS)}

    if action == "revise" or pending not in editable:
        return _ask_what_to_edit(state, req, family)

    if pending and pending != EDIT_TARGET:
        if not answer:
            question, llm_meta = _revise_field_question(pending, req, family, state, catalog)
            return {
                "text": question["prompt"],
                "state": {
                    **state,
                    "phase": "revising",
                    "buildNew": True,
                    "pendingField": pending,
                    "pendingPrompt": question["prompt"],
                    "pendingChoices": question.get("choices") or [],
                    "pendingMulti": bool(question.get("multi")),
                },
                "cards": _public_cards([_choice_card(question)]),
                "llm": llm_meta,
            }
        req = apply_answer(req, pending, answer, state.get("pendingChoices") or [])
        log = list(state.get("answersLog") or [])
        log.append({"field": pending, "prompt": state.get("pendingPrompt") or pending, "answer": answer})
        if pending == "sources" and (req.get("extras") or {}).get("needSourceNames") == "true":
            question, llm_meta = _revise_field_question("sourceNames", req, family, state, catalog)
            return {
                "text": question["prompt"],
                "state": {
                    **state,
                    "phase": "revising",
                    "buildNew": True,
                    "requirement": req,
                    "family": family,
                    "answersLog": log,
                    "pendingField": "sourceNames",
                    "pendingPrompt": question["prompt"],
                    "pendingChoices": question.get("choices") or [],
                    "pendingMulti": True,
                },
                "cards": _public_cards([_choice_card(question)]),
                "llm": llm_meta,
            }
        return _confirming_reply(state, req, log, family)

    # pending == EDIT_TARGET: user chose which part to edit, or typed a change.
    if not answer:
        return _ask_what_to_edit(state, req, family)

    field = _edit_field_from_answer(answer)
    if field:
        question, llm_meta = _revise_field_question(field, req, family, state, catalog)
        return {
            "text": question["prompt"],
            "state": {
                **state,
                "phase": "revising",
                "buildNew": True,
                "requirement": req,
                "family": family,
                "pendingField": field,
                "pendingPrompt": question["prompt"],
                "pendingChoices": question.get("choices") or [],
                "pendingMulti": bool(question.get("multi")),
            },
            "cards": _public_cards([_choice_card(question)]),
            "llm": llm_meta,
        }

    return {
        "text": "I didn't catch which part to edit. Choose a field below, or type something like “frequency to daily”.",
        "state": {
            **state,
            "phase": "revising",
            "pendingField": EDIT_TARGET,
            "pendingChoices": _edit_choices(req),
        },
        "cards": _public_cards(
            [
                _choice_card(
                    {
                        "field": EDIT_TARGET,
                        "prompt": "What would you like to change?",
                        "choices": _edit_choices(req),
                        "multi": False,
                        "allowOther": True,
                    }
                )
            ]
        ),
        "llm": {"provider": "none", "used": False, "configured": llm_config() is not None},
    }


def _choice_card(question: dict) -> dict:
    card = {
        "type": "choice_question",
        "title": question["prompt"],
        "field": question["field"],
        "choices": question.get("choices") or [],
        "multi": bool(question.get("multi")),
        "allowOther": question.get("allowOther", True),
    }
    if question.get("selected"):
        card["selected"] = list(question["selected"])
    return card


def _shape_question(question: dict, req: dict) -> dict:
    extras = req.get("extras") or {}
    if question.get("field") == "extras.rankingMethod" and extras.get("rankingHint"):
        hint = extras["rankingHint"]
        return {
            **question,
            "prompt": (
                f'Should "{hint}" be determined using a specific ranking/source, '
                "or should Freda build the ranking based on available public information?"
            ),
        }
    return question


def _pinned_choices(field: str, family: str) -> list[str] | None:
    """Keep firmographic list questions on one dimension even if the model mixes options."""
    if family != "firmographic":
        return None
    if field == "extras.companyType":
        return list(COMPANY_TYPE_CHOICES)
    if field == "extras.sizeFilter":
        return list(SIZE_FILTER_CHOICES)
    if field == "extras.listSize":
        return list(LIST_SIZE_CHOICES)
    if field == "sources":
        return list(COMPANY_LIST_SOURCE_CHOICES)
    return None


def _compose_question(question: dict, req: dict, family: str, state: dict, editing: bool = False) -> tuple[dict, str]:
    if editing:
        instructions = (
            "The user is editing this field. Ask it even if it already appears in known_scope. "
            "Choices must match the entity, not a sibling sub-vertical of the matched Solution. "
            "Keep currently selected values in the choices."
        )
    else:
        instructions = (
            "Generate one question for the missing field only. "
            "Do not ask about known_scope keys. Complete the scope, not a questionnaire."
        )
    payload = {
        "field": question["field"],
        "entity": req.get("entityType"),
        "family": family,
        "known_scope": _known_facts(req),
        "requirement": req,
        "gaps": state.get("gaps") or [],
        "editing": editing,
        "multi": bool(question.get("multi")),
        "fallback_choices": question.get("choices") or [],
        "catalog_hints": {
            "attributes": [
                attr
                for sol in (state.get("solutionHits") or [])[:3]
                for attr in (sol.get("attributes") or [])
            ],
            "sources": [
                name
                for sol in (state.get("solutionHits") or [])[:3]
                for name in (sol.get("sourceNames") or [])
            ],
            "solutions": [sol.get("name") for sol in (state.get("solutionHits") or [])[:3] if sol.get("name")],
        },
        "instructions": instructions,
    }
    composed, provider = compose_scope_question(payload)
    if not composed:
        return question, "none"
    if not composed.get("choices"):
        composed["choices"] = question.get("choices") or []
    composed["allowOther"] = composed.get("allowOther", True)
    if question.get("selected"):
        composed["selected"] = list(question["selected"])
        for item in reversed(list(question["selected"])):
            if item not in (composed.get("choices") or []):
                composed.setdefault("choices", []).insert(0, item)
    pinned = _pinned_choices(composed.get("field") or "", family)
    if pinned:
        composed["choices"] = pinned
    if composed.get("field") == "attributes":
        composed["choices"] = coerce_attribute_choices(
            str(req.get("entityType") or ""),
            composed.get("choices") or [],
            list(req.get("attributes") or []),
        )
    return composed, provider


def _handle_build_new(message: str, state: dict, action: str | None, catalog: dict | None = None) -> dict:
    original = _original_request(state, message or "")
    reset = action in {"build_new", "expand"}
    seed = None if action == "build_new" else state.get("requirement")
    req = extract_requirement(original, seed)
    if action not in {"build_new", "expand", "revise"} and (message or "").strip() and not BUILD_NEW_PHRASE.search(message or ""):
        req = extract_requirement(message, req)
    if not req.get("objective") and original:
        req["objective"] = original
    family = family_for(original, state.get("family"))
    asked = [] if reset else list(state.get("askedFields") or [])
    log = [] if reset else list(state.get("answersLog") or [])
    pending = None if reset else state.get("pendingField")
    pending_prompt = None if reset else state.get("pendingPrompt")
    prior_match = state.get("matchKind")
    chose_new_after_match = action == "build_new" and (
        prior_match in {"existing", "partial"}
        or bool(state.get("solutionHits") or state.get("agentHits"))
    )
    if action == "expand":
        state = {**state, "scopeMode": "customize", "matchKind": state.get("matchKind") or "partial"}
    elif action == "build_new":
        state = {**state, "scopeMode": "new", "matchKind": "none"}

    answer_text = (message or "").strip()
    if action in {"build_new", "revise", "expand"} or (answer_text and BUILD_NEW_PHRASE.search(answer_text)):
        answer_text = ""

    if pending and action not in {"build_new", "revise", "expand"}:
        if not answer_text:
            question = _shape_question(
                {
                    "field": pending,
                    "prompt": pending_prompt or pending,
                    "choices": (state.get("pendingChoices") or []),
                    "multi": bool(state.get("pendingMulti")),
                    "allowOther": True,
                },
                req,
            )
            return {
                "text": "Please choose an option or type your own answer to continue.",
                "state": {
                    **state,
                    "phase": "gathering",
                    "buildNew": True,
                    "requirement": req,
                    "family": family,
                    "askedFields": asked,
                    "answersLog": log,
                    "pendingField": pending,
                    "pendingPrompt": question["prompt"],
                    "lastUserMessage": original or state.get("lastUserMessage"),
                },
                "cards": _public_cards([_choice_card(question)]),
                "llm": {"provider": "none", "used": False, "configured": llm_config() is not None},
            }
        req = apply_answer(req, pending, answer_text, state.get("pendingChoices") or [])
        asked = list(dict.fromkeys([*asked, pending]))
        log.append({"field": pending, "prompt": pending_prompt or pending, "answer": answer_text})
        pending = None
        pending_prompt = None
    elif action not in {"build_new", "revise", "expand"} and answer_text and state.get("phase") == "confirming":
        req.setdefault("extras", {})
        notes = req["extras"].get("notes") or ""
        req["extras"]["notes"] = f"{notes}; {answer_text}".strip("; ") if notes else answer_text
        log.append({"field": "notes", "prompt": "Additional notes", "answer": answer_text})

    question = next_question(
        family,
        req,
        asked,
        catalog=catalog,
        solution_hits=state.get("solutionHits") or [],
    )
    llm_meta = {"provider": "none", "used": False, "configured": llm_config() is not None}
    if question:
        question, provider = _compose_question(question, req, family, state)
        if provider != "none":
            llm_meta = {"provider": provider, "used": True, "configured": True}
    next_state = {
        **state,
        "buildNew": True,
        "requirement": req,
        "family": family,
        "askedFields": asked,
        "answersLog": log,
        "matchKind": "none" if (state.get("scopeMode") or action) == "new" or action == "build_new" else (state.get("matchKind") or "none"),
        "lastUserMessage": original or state.get("lastUserMessage"),
        "gaps": state.get("gaps") or [],
    }

    if question:
        question = _shape_question(question, req)
        facts = _known_facts(req)
        known = [f"{label}: {value}" for label, value in facts.items() if label != "Original request"]
        if not log:
            if state.get("scopeMode") == "customize" or action == "expand":
                lead = "We'll customize the existing capability. I only need the details that are still missing."
            elif chose_new_after_match:
                lead = "Sure. I can help define this as a new data scope."
            else:
                lead = (
                    "I couldn't find an existing Freda capability that fully matches your requirement. "
                    "I can help define this as a new data scope."
                )
            if known:
                lead += " I already have " + "; ".join(known) + "."
            text = f"{lead} {question['prompt']}"
        else:
            text = question["prompt"]
        next_state.update(
            {
                "phase": "gathering",
                "pendingField": question["field"],
                "pendingPrompt": question["prompt"],
                "pendingChoices": question.get("choices") or [],
                "pendingMulti": bool(question.get("multi")),
            }
        )
        return {
            "text": text,
            "state": next_state,
            "cards": _public_cards([_choice_card(question)]),
            "llm": llm_meta,
        }

    next_state.update(
        {
            "phase": "confirming",
            "pendingField": None,
            "pendingPrompt": None,
            "pendingChoices": [],
            "pendingMulti": False,
        }
    )
    return {
        "text": "Here is the requirement I collected. Review it and submit the request to create a ticket in Monitoring.",
        "state": next_state,
        "cards": _public_cards(
            [
                {
                    "type": "summary",
                    "title": "Review your new requirement",
                    "summary": _review_summary(req, log),
                    "options": [
                        {"id": "revise", "label": "Edit scope"},
                        {"id": "submit_job", "label": "Submit request"},
                    ],
                }
            ]
        ),
            "llm": llm_meta,
        }


def handle_chat(message: str, incoming: dict | None, action: str | None, history: list[dict] | None) -> dict:
    catalog = load_catalog()
    agents_by_id, solutions_by_id = _catalog_index(catalog)
    state = {**INITIAL_STATE, **(incoming or {})}
    state["requirement"] = _merge_requirement(state.get("requirement"), None)
    retrieved = retrieve(message or state.get("lastUserMessage") or "", catalog)

    if not action and (state.get("phase") == "awaiting_path") and message:
        if re.search(r"\b(use this|use existing|use it|without the missing)\b", message, re.I):
            action = "use_existing"
        elif re.search(r"\b(customize|extend|customise)\b", message, re.I):
            action = "expand"
        elif re.search(r"\b(build new|new requirement|new dataset|new scope|create new)\b", message, re.I):
            action = "build_new"

    if not action and state.get("phase") in {"confirming", "revising"} and EDIT_PHRASE.search(message or ""):
        action = "revise"

    if action == "use_existing":
        agent_hits = state.get("agentHits") or []
        solution_hits = state.get("solutionHits") or []
        next_state = {**state, "phase": "idle", "matchKind": "existing"}
        primary = (solution_hits[0].get("name") if solution_hits else None) or (
            agent_hits[0].get("name") if agent_hits else None
        ) or "this catalog capability"
        return {
            "text": _strip_catalog_ids(f"{primary} already covers this. Open it to use it as-is — no extra questions."),
            "state": next_state,
            "cards": _public_cards([_capability_card("existing", agent_hits, solution_hits, state.get("requirement"))]),
            "llm": {"provider": "none", "used": False},
        }

    if action == "submit_job" or (
        state.get("buildNew")
        and state.get("phase") == "confirming"
        and message
        and SUBMIT_PHRASE.search(message)
    ):
        estimate = state.get("estimate") or _estimate(state)
        if state.get("buildNew"):
            estimate = {
                **estimate,
                "timeline": "Pending Solutions review for a new requirement.",
                "volume": (state.get("requirement") or {}).get("extras", {}).get("volume")
                or estimate.get("volume")
                or "To be confirmed",
            }
        try:
            job = create_job(
                {
                    "title": state["requirement"].get("entityType")
                    or state["requirement"].get("objective")
                    or "Ask Freda requirement",
                    "requirement": state["requirement"],
                    "family": state.get("family") or "generic",
                    "estimate": estimate,
                    "answers": state.get("answersLog") or [],
                }
            )
        except Exception:
            return {
                "text": (
                    "I couldn't submit that requirement to the Freda platform. "
                    "Please try again in a moment."
                ),
                "state": state,
                "cards": [],
                "llm": {"provider": "none", "used": False},
            }
        state = {
            **state,
            "phase": "submitted",
            "jobId": job["id"],
            "estimate": estimate,
            "buildNew": False,
            "pendingField": None,
        }
        return {
            "text": (
                f"Your new data requirement has been submitted to the Freda platform. "
                f"Ticket {job['id']} is marked {job.get('status') or 'Solution Requested'}. "
                "Track it in Monitoring for review."
            ),
            "state": state,
            "cards": [{"type": "job", "title": "Submitted to Freda", "job": job}],
            "llm": {"provider": "none", "used": False},
        }

    if (
        action == "revise"
        or state.get("phase") == "revising"
        or state.get("pendingField") == EDIT_TARGET
    ):
        return _handle_revise(message, state, action, catalog)

    if action in {"build_new", "expand", "answer_question"} or (
        state.get("buildNew")
        and state.get("phase") in {"gathering", "confirming"}
        and action not in {"use_existing", "submit_job", "revise"}
    ):
        return _handle_build_new(message, state, action, catalog)

    if action == "confirm":
        estimate = _estimate(state)
        next_state = {**state, "phase": "estimated", "estimate": estimate}
        return {
            "text": "Here is an estimate from catalog metadata only — no pricing.",
            "state": next_state,
            "cards": _public_cards(
                [
                    {
                        "type": "estimate",
                        "title": "Estimate & proposed solution",
                        "estimate": estimate,
                        "options": [{"id": "submit_job", "label": "Create job / send to onboarding"}],
                    }
                ]
            ),
            "llm": {"provider": "none", "used": False},
        }

    if classify_intent(message or "") == "metadata" or bool(CATALOG_QUESTION.search(message or "")):
        return {
            "text": _strip_catalog_ids(_metadata_text(message or "", catalog)),
            "state": {**state, "phase": "idle", "lastUserMessage": message or state.get("lastUserMessage")},
            "cards": _public_cards(_metadata_cards(message or "", catalog)),
            "llm": {"provider": "none", "used": False},
        }

    later_phase = state.get("phase") in {"confirming", "estimated", "submitted"}
    if not later_phase:
        matched = _catalog_match_reply(message or "", state, catalog)
        if matched:
            return matched
        requirement = extract_requirement(message or "", state.get("requirement"))
        next_state = {
            **state,
            "requirement": _merge_requirement(state.get("requirement"), requirement),
            "family": family_for(message or "", state.get("family")),
            "matchKind": "none",
            "agentHits": [],
            "solutionHits": [],
            "gaps": [],
            "lastUserMessage": message or state.get("lastUserMessage"),
            "buildNew": True,
            "scopeMode": "new",
        }
        return _handle_build_new(message or "", next_state, "build_new", catalog)

    payload = {
        "user_message": message,
        "action": action,
        "conversation_state": {
            "phase": state.get("phase"),
            "askedFields": state.get("askedFields"),
            "matchKind": state.get("matchKind"),
            "requirement": state.get("requirement"),
        },
        "history": history or [],
        "catalog_context": compact_context(retrieved),
        "instructions": (
            "Use only catalog_context IDs. A packaged Solution is an existing capability — "
            "do not treat a missing Agent as a miss. Prefer existing matches. "
            "When a Solution or Agent matches, set query_kind=requirement, put IDs in "
            "solution_ids/agent_ids, and set show_path_options true."
        ),
    }

    llm_out, provider = complete_json(payload, retrieved=retrieved, catalog=catalog)
    requirement = _merge_requirement(state.get("requirement"), llm_out.get("requirement"))
    if retrieved.get("country") and not requirement.get("country"):
        requirement["country"] = retrieved["country"]
        requirement["geography"] = requirement.get("geography") or retrieved["country"]

    llm_agent_ids = list(llm_out.get("agent_ids") or [])
    llm_solution_ids = list(llm_out.get("solution_ids") or [])
    retrieved_sol_ids = [s["id"] for s in retrieved["solutions"][:3]]
    if retrieved_sol_ids:
        merged_sols: list[str] = []
        for sid in [*retrieved_sol_ids, *llm_solution_ids]:
            if sid not in merged_sols:
                merged_sols.append(sid)
        llm_solution_ids = merged_sols[:4]
    if not llm_agent_ids and not retrieved["solutions"]:
        llm_agent_ids = [a["id"] for a in retrieved["agents"][:3]]

    agent_hits = _hydrate_agents(llm_agent_ids, retrieved["agents"], agents_by_id)
    solution_hits = _hydrate_solutions(llm_solution_ids, retrieved, solutions_by_id, catalog)
    if not agent_hits and retrieved["agents"] and not solution_hits:
        agent_hits = retrieved["agents"][:3]
    if not solution_hits and retrieved["solutions"]:
        solution_hits = retrieved["solutions"][:3]

    # Prefer the packaged Solution as the clickable capability; skip unrelated agents.
    if solution_hits:
        agent_hits = [
            a for a in agent_hits
            if a.get("id") in set(llm_out.get("agent_ids") or [])
        ]

    gaps = llm_out.get("gaps") or []
    phase = llm_out.get("phase") or "idle"
    match_kind = llm_out.get("match_kind")
    if (agent_hits or solution_hits) and match_kind not in {"existing", "partial"}:
        match_kind = "partial" if gaps else "existing"
    next_state = {
        **state,
        "phase": phase,
        "requirement": requirement,
        "matchKind": match_kind,
        "family": retrieved.get("family") or state.get("family") or "generic",
        "agentHits": agent_hits,
        "solutionHits": solution_hits,
        "gaps": gaps,
        "lastUserMessage": message or state.get("lastUserMessage"),
        "askedFields": list(state.get("askedFields") or []),
    }
    if llm_out.get("next_question"):
        next_state["askedFields"] = list(dict.fromkeys([*next_state["askedFields"], "followup"]))

    cards: list[dict] = []
    query_kind = llm_out.get("query_kind") or "requirement"
    catalog_question = bool(CATALOG_QUESTION.search(message or ""))
    original_kind = query_kind
    if (agent_hits or solution_hits) and not catalog_question:
        query_kind = "requirement"
        if phase not in {"confirming", "estimated", "submitted"} and action not in {
            "build_new",
            "confirm",
            "revise",
        }:
            phase = "awaiting_path"
        next_state["phase"] = phase
        next_state["matchKind"] = match_kind

    if query_kind == "metadata":
        cards.extend(_metadata_cards(message or "", catalog))
    else:
        if agent_hits or solution_hits:
            cards.append(_capability_card(match_kind, agent_hits, solution_hits))
        if gaps:
            cards.append({"type": "gaps", "title": "Gaps versus your requirement", "gaps": gaps})
        show_paths = (
            (agent_hits or solution_hits)
            and phase not in {"confirming", "estimated", "submitted", "gathering"}
        ) or llm_out.get("show_path_options") or phase == "awaiting_path"
        if show_paths and phase not in {"confirming", "estimated", "submitted"}:
            next_state["phase"] = "awaiting_path"
            cards.append(_path_card(match_kind, agent_hits, solution_hits, gaps))
        if phase == "gathering" and llm_out.get("next_question") and not show_paths:
            cards.append({"type": "questions", "questions": [llm_out["next_question"]]})
        if phase == "confirming":
            cards.append(
                {
                    "type": "summary",
                    "title": "Proposed requirement",
                    "summary": _summary(requirement),
                    "options": [
                        {"id": "confirm", "label": "Looks correct"},
                        {"id": "revise", "label": "Make changes"},
                    ],
                }
            )
        if action == "confirm" or phase == "estimated":
            estimate = _estimate(next_state)
            next_state["estimate"] = estimate
            next_state["phase"] = "estimated"
            cards.append(
                {
                    "type": "estimate",
                    "title": "Estimate & proposed solution",
                    "estimate": estimate,
                    "options": [{"id": "submit_job", "label": "Create job / send to onboarding"}],
                }
            )

    if llm_out.get("create_job") and action != "submit_job":
        # LLM asked to create a job; wait for explicit user confirm via the card.
        pass

    text = llm_out.get("text") or "I checked the F.R.E.D.A. catalog."
    if query_kind == "requirement" and (agent_hits or solution_hits) and (
        original_kind == "metadata"
        or not (llm_out.get("solution_ids") or llm_out.get("agent_ids"))
        or re.search(r"don.?t see a dedicated agent|no dedicated agent", text, re.I)
    ):
        text = _recommend_text(agent_hits, solution_hits)
    return {
        "text": _strip_catalog_ids(text),
        "state": next_state,
        "cards": _public_cards(cards),
        "llm": {"provider": provider, "used": True, "configured": llm_config() is not None},
    }


def health() -> dict:
    cfg = llm_config()
    catalog = load_catalog()
    return {
        "ok": True,
        "llm": {"configured": cfg is not None, "provider": cfg.provider if cfg else None, "model": cfg.model if cfg else None},
        "catalog": {
            "agents": len(catalog["agents"]),
            "solutions": len(catalog["solutions"]),
            "sources": len(catalog["sources"]),
        },
        "jobs": len(list_jobs()),
    }
