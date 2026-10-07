from __future__ import annotations

import re

METADATA_RE = re.compile(
    r"(how many\s+agents|how many\s+solutions|list the solution|solution catalogue|"
    r"solution catalog|what sheets|catalog sheets|sheet(s)? (are|in)|catalog overview|"
    r"what('?s| is) in the catalog)",
    re.I,
)


def synthesize(payload: dict, retrieved: dict, catalog: dict) -> dict:
    """Catalog-grounded reply used when no LLM key is configured."""
    message = (payload.get("user_message") or "").strip()
    action = payload.get("action")
    state = payload.get("conversation_state") or {}
    agents = retrieved.get("agents") or []
    solutions = retrieved.get("solutions") or []
    requirement = dict(state.get("requirement") or {})
    if retrieved.get("country"):
        requirement.setdefault("country", retrieved["country"])
        requirement.setdefault("geography", retrieved["country"])
    if message and not requirement.get("objective"):
        requirement["objective"] = message

    if action == "use_existing":
        names = [s["name"] for s in solutions[:2]] + [a["name"] for a in agents[:2]]
        named = ", ".join(dict.fromkeys(names)) or "this catalog capability"
        return {
            "text": f"{named} already covers this. Open it from the card to use it as-is.",
            "query_kind": "requirement",
            "match_kind": "existing",
            "phase": "idle",
            "agent_ids": [a["id"] for a in agents[:4]],
            "solution_ids": [s["id"] for s in solutions[:3]],
            "gaps": [],
            "next_question": None,
            "requirement": requirement,
            "create_job": False,
            "show_path_options": False,
        }
    if action == "confirm":
        return {
            "text": "Here is an estimate from catalog metadata only — no pricing, and no internal workflow IDs.",
            "query_kind": "requirement",
            "match_kind": state.get("matchKind") or "none",
            "phase": "estimated",
            "agent_ids": [a["id"] for a in agents[:4]],
            "solution_ids": [s["id"] for s in solutions[:3]],
            "gaps": state.get("gaps") or [],
            "next_question": None,
            "requirement": requirement,
            "create_job": False,
            "show_path_options": False,
        }
    if action == "revise":
        return {
            "text": "Tell me what to change — sources, attributes, market, or refresh — and I will update the requirement.",
            "query_kind": "requirement",
            "match_kind": state.get("matchKind"),
            "phase": "gathering",
            "agent_ids": [a["id"] for a in agents[:4]],
            "solution_ids": [s["id"] for s in solutions[:3]],
            "gaps": [],
            "next_question": "What should I revise in the proposed requirement?",
            "requirement": requirement,
            "create_job": False,
            "show_path_options": False,
        }
    if action == "expand":
        return {
            "text": "We can extend the existing capability instead of starting from scratch. Confirm the requirement below and I will send it to onboarding.",
            "query_kind": "requirement",
            "match_kind": "partial",
            "phase": "confirming",
            "agent_ids": [a["id"] for a in agents[:4]],
            "solution_ids": [s["id"] for s in solutions[:3]],
            "gaps": state.get("gaps") or [],
            "next_question": None,
            "requirement": requirement,
            "create_job": False,
            "show_path_options": False,
        }
    if action == "build_new":
        return {
            "text": "Understood — we will treat this as a new dataset rather than an extension. I have enough to propose a requirement unless you want to add sources or attributes.",
            "query_kind": "requirement",
            "match_kind": "none",
            "phase": "confirming",
            "agent_ids": [],
            "solution_ids": [],
            "gaps": [],
            "next_question": None,
            "requirement": requirement,
            "create_job": False,
            "show_path_options": False,
        }

    if METADATA_RE.search(message):
        return _metadata(message, catalog)

    gaps = _gaps(message, agents, solutions)
    if agents or solutions:
        match_kind = "partial" if gaps else "existing"
    else:
        match_kind = "none"

    agent_ids = [a["id"] for a in agents[:4]]
    solution_ids = [s["id"] for s in solutions[:3]]

    if match_kind == "existing":
        names = [s["name"] for s in solutions[:2]] or [a["name"] for a in agents[:2]]
        named = ", ".join(dict.fromkeys(names))
        text = (
            f"This is already covered in the catalog. I recommend reusing {named} "
            "rather than building a duplicate. You can use this capability "
            "or build a new requirement. Coverage and accuracy figures below are per Solution, not platform-wide."
        )
        return {
            "text": text,
            "query_kind": "requirement",
            "match_kind": "existing",
            "phase": "awaiting_path",
            "agent_ids": agent_ids,
            "solution_ids": solution_ids,
            "gaps": gaps,
            "next_question": None,
            "requirement": requirement,
            "create_job": False,
            "show_path_options": True,
        }

    if match_kind == "partial":
        gap_text = "; ".join(g["detail"] for g in gaps[:2]) or "some requested fields are not indexed"
        names = [s["name"] for s in solutions[:2]] or [a["name"] for a in agents[:2]]
        named = ", ".join(names) if names else "a related capability"
        text = (
            f"There is a partial match on {named}. {gap_text} "
            "You can use this capability or build a new requirement."
        )
        return {
            "text": text,
            "query_kind": "requirement",
            "match_kind": "partial",
            "phase": "awaiting_path",
            "agent_ids": agent_ids,
            "solution_ids": solution_ids,
            "gaps": gaps,
            "next_question": None,
            "requirement": requirement,
            "create_job": False,
            "show_path_options": True,
        }

    question = _next_question(message, requirement)
    return {
        "text": (
            "I did not find an existing Agent or Solution that covers this as indexed. "
            "I will gather only what is still missing, then confirm a new requirement."
        ),
        "query_kind": "requirement",
        "match_kind": "none",
        "phase": "gathering",
        "agent_ids": [],
        "solution_ids": [],
        "gaps": [],
        "next_question": question,
        "requirement": requirement,
        "create_job": False,
        "show_path_options": False,
    }


def _metadata(message: str, catalog: dict) -> dict:
    q = message.lower()
    if "sheet" in q:
        text = (
            f"The workbook Ask Freda reads has Overview plus Agents, Solutions, Sources, and facet sheets. "
            f"There are {len(catalog['agents'])} Agents, {len(catalog['solutions'])} Solutions, "
            f"and {len(catalog['sources'])} source rows."
        )
    elif "solution" in q:
        cats = len(catalog["solutionsByCategory"])
        text = (
            f"There are {len(catalog['solutions'])} packaged Solutions across {cats} categories. "
            "Figures on each Solution are per-Solution, not platform-wide."
        )
    elif "agent" in q:
        text = f"The Agent catalog currently has {len(catalog['agents'])} extraction agents."
    else:
        bits = [f"{row['label']}: {row['value']}" for row in catalog["overview"][:8]]
        text = "Catalog overview:\n" + "\n".join(bits)
    return {
        "text": text,
        "query_kind": "metadata",
        "match_kind": None,
        "phase": "idle",
        "agent_ids": [],
        "solution_ids": [],
        "gaps": [],
        "next_question": None,
        "requirement": {},
        "create_job": False,
        "show_path_options": False,
    }


def _gaps(message: str, agents: list[dict], solutions: list[dict]) -> list[dict]:
    gaps: list[dict] = []
    lower = message.lower()
    if re.search(r"15\s*-?\s*min|every 15", lower):
        cadence = (solutions[0].get("refreshCadence") if solutions else "") or "not specified"
        gaps.append(
            {
                "field": "frequency",
                "detail": (
                    f"Requested 15-minute refresh; matched capability default is {cadence}. "
                    "Sub-hourly status cadence is not explicitly indexed."
                ),
            }
        )
    if "flight" in lower and "status" in lower:
        attrs = " ".join((solutions[0].get("attributes") or []) if solutions else []).lower()
        if "status" not in attrs:
            gaps.append(
                {
                    "field": "attributes",
                    "detail": "Flight status is not listed as an indexed output attribute on the matched travel capability.",
                }
            )
    if re.search(r"\bnse\b", lower):
        if not any("nse" in (a.get("name") or "").lower() for a in agents):
            gaps.append(
                {
                    "field": "sources",
                    "detail": "No dedicated NSE Agent is indexed in the catalog. A BSE Agent may exist as a related filing source.",
                }
            )
    return gaps


def _next_question(message: str, requirement: dict) -> str:
    if not requirement.get("geography") and not requirement.get("country"):
        return "Which market or country should this dataset cover?"
    if not requirement.get("sources"):
        return "Which websites or source names should we extract from, if you know them?"
    if not requirement.get("attributes"):
        return "Which fields or attributes are required in the output?"
    if not requirement.get("frequency"):
        return "How often should this data refresh?"
    return "Is there anything else that must be in scope before I confirm the requirement?"
