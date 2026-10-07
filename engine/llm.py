from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from fallback import synthesize

load_dotenv(Path(__file__).resolve().parent / ".env")
load_dotenv()

SYSTEM_PROMPT = """You are Ask Freda, the conversational AI consultant for the F.R.E.D.A. Data Platform.

Follow the product rules exactly:
- Understand the user's data requirement before asking questions.
- Always check existing Agents, Solutions, and sources in the CATALOG CONTEXT first.
- Reuse first, extend second, create new third.
- Maintain a structured scope after every turn. Never drop user-provided sources, geography, or attributes.
- A packaged Solution is an existing capability only when entity, use case, attributes, and sources align — not merely because the word “company” appears.
- If a Solution covers the need: query_kind="requirement", match_kind="existing" (or "partial" only when there is a real gap), put its id in solution_ids, set show_path_options true, and phase="awaiting_path".
- Ask the user to use this capability, customize/extend it, or create a new scope. Do not start a new requirement until they choose that path.
- Do not treat “Show me …” as “create a new dataset”.
- query_kind="metadata" only for catalog introspection (how many agents, list the catalogue, what sheets). Never metadata when a matching Solution or Agent is in context.
- Classify as existing, partial, or none using hard constraints, not keyword overlap alone.
- Geography and attributes are separate fields. “Pricing in India” means attribute=Pricing and geography=India.
- Preserve named sources (BSE, NSE, company websites) for the whole conversation.
- If ALL available fields is selected, store attributes as All available fields only — do not also store every option.
- Ask only missing, entity-specific questions after the user chooses to customize or create a new scope. Complete the scope, not a questionnaire.
- Do not invent Agents, Solutions, source names, or URLs. Only use IDs present in the catalog context.
- Put catalog IDs only in agent_ids and solution_ids. Never write Agent IDs, Solution IDs, or source IDs in the user-facing text — use names only (say “Firmographic Data”, not “ds-firmographic”).
- Do not repeat facts the user already provided.
- Ask at most one missing, intent-specific question when needed — and only after the user chooses to build new.
- Do not mention pricing or internal workflow IDs.
- Coverage/accuracy figures are per Solution, never platform-wide.
- If the user asks about sheets/counts/catalog contents, answer from overview metadata.

Return ONLY valid JSON with this shape:
{
  "text": "user-facing reply in the voice of a data consultant",
  "query_kind": "metadata" | "requirement",
  "match_kind": "existing" | "partial" | "none" | null,
  "phase": "idle" | "gathering" | "awaiting_path" | "confirming" | "estimated" | "submitted",
  "agent_ids": ["..."],
  "solution_ids": ["..."],
  "gaps": [{"field": "...", "detail": "..."}],
  "next_question": null or string,
  "requirement": {
    "objective": "",
    "entityType": "",
    "industry": "",
    "geography": "",
    "country": "",
    "city": "",
    "sources": [],
    "sourceUrls": [],
    "attributes": [],
    "frequency": "",
    "recurring": null
  },
  "create_job": false,
  "show_path_options": false,
  "suggest_sources": false
}
"""


@dataclass
class LLMConfig:
    client: OpenAI
    model: str
    provider: str


def llm_config() -> LLMConfig | None:
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_key:
        base = os.getenv("OPENAI_BASE_URL", "").strip() or None
        return LLMConfig(
            OpenAI(api_key=openai_key, base_url=base),
            os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            "openai",
        )

    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if groq_key:
        return LLMConfig(
            OpenAI(api_key=groq_key, base_url="https://api.groq.com/openai/v1"),
            os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            "groq",
        )

    base = os.getenv("FREDA_LLM_BASE_URL", "").strip()
    if base:
        return LLMConfig(
            OpenAI(api_key=os.getenv("FREDA_LLM_API_KEY", "not-needed"), base_url=base.rstrip("/")),
            os.getenv("FREDA_LLM_MODEL", "llama3.1"),
            "openai-compatible",
        )
    return None


def _parse_json(content: str) -> dict:
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text, flags=re.I).strip()
        text = re.sub(r"```$", "", text).strip()
    return json.loads(text)


def complete_json(user_payload: dict, retrieved: dict | None = None, catalog: dict | None = None) -> tuple[dict, str]:
    cfg = llm_config()
    if cfg is None:
        if retrieved is None or catalog is None:
            raise RuntimeError(
                "No LLM configured. Set OPENAI_API_KEY (or GROQ_API_KEY / FREDA_LLM_BASE_URL) in backend/.env"
            )
        return synthesize(user_payload, retrieved, catalog), "catalog-fallback"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
    ]
    try:
        response = cfg.client.chat.completions.create(
            model=cfg.model,
            response_format={"type": "json_object"},
            messages=messages,
            timeout=60,
        )
    except Exception:
        response = cfg.client.chat.completions.create(
            model=cfg.model,
            temperature=0.2,
            messages=messages,
            timeout=60,
        )
    content = response.choices[0].message.content or "{}"
    try:
        parsed = _parse_json(content)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"LLM returned non-JSON: {content[:400]}") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("LLM JSON was not an object")
    parsed.setdefault("text", "I checked the F.R.E.D.A. catalog.")
    return parsed, cfg.provider


QUESTION_SYSTEM = """You write the next missing scoping question for Ask Freda, a data-platform consultant.

You do not run a questionnaire. You receive exactly one missing field. Ask only that field.
Return ONLY JSON:
{
  "field": "<the same field you were given>",
  "prompt": "one consultant question, specific to this entity and known facts",
  "choices": ["4-8 relevant options"],
  "multi": false,
  "allowOther": true
}

Rules:
- Prompt must be generated for this ENTITY and the known scope, never for the matched Solution in general.
  A Solution can cover several sub-verticals with one shared attribute list (e.g. ds-travel covers both
  hotels and flights; ds-healthcare-providers covers hospitals, clinics AND individual doctors). The entity
  the user actually named (e.g. "airlines") is always the source of truth — not the Solution's label or tagline.
- catalog_hints are a starting point tied to the matched Solution, NOT a literal answer key. Before using them
  as choices:
  1. Keep only the hints that a person working with this entity would recognize as their own fields.
  2. Drop hints that clearly belong to a different sub-vertical of the same Solution (e.g. Room Type, Amenities,
     Nightly Price, Cancellation Policy for a HOTEL do not belong on a question about AIRLINES).
  3. If, after dropping mismatched hints, fewer than 4 relevant options remain, fill the rest with realistic
     field names for THIS entity's domain (e.g. for airlines: Flight Number, Airline, Origin, Destination,
     Departure Time, Arrival Time, Fare Class, Baggage Allowance, Layovers, Aircraft Type). This is ordinary
     domain vocabulary, not inventing an Agent, Solution, ID, or URL — those stay off-limits.
- If known facts already include geography, attributes, or sources, do not ask them again.
- If the payload has "editing": true, the user explicitly chose to change this field. Ask it even when known_scope already contains it. Keep any currently selected values among the choices.
- For attributes: multi=true and include "All available fields" last.
- For frequency: use freshness options (Real-time, Hourly, Daily, Weekly, Monthly, Quarterly, On-demand, One-time).
- One question, one dimension. Never mix company ownership with size filters or list length in the same choices.
- For extras.companyType: ownership only. multi=true. Choices like Public, Private, Startup, All companies.
- For extras.sizeFilter: size only. multi=true. Choices like Filter by employee count, Filter by annual revenue range, No size filter.
- For extras.listSize: how many records. Choices like Top 50, Top 100, Top 250, Top 500, All matching companies.
- For sources on a company list (firmographic): do NOT offer LinkedIn, websites, or catalog source names.
  Choices must be how the company list is obtained:
  "I'll upload a list", "Ask the Freda team to generate a list", "Get the list from Wikipedia or a third party".
- Do not invent Agents, Solutions, IDs, or URLs.
- Complete the scope, not a form. Keep the question short.

Below are contrastive examples: the SAME matched Solution, producing DIFFERENT questions because the entity differs.
This is the pattern to follow — never the reverse.

### Solution: ds-travel | Entity: Hotels
{"field": "attributes", "prompt": "Which hotel details do you need?", "choices": ["Nightly price & availability", "Room type & amenities", "Star rating & cancellation policy", "Review score & count", "Taxes & fees", "All available fields"], "multi": true, "allowOther": true}

### Solution: ds-travel | Entity: Airlines / Flights
{"field": "attributes", "prompt": "Which flight details do you need?", "choices": ["Flight number & airline", "Origin & destination", "Departure / arrival time", "Fare class & price", "Layovers & duration", "Baggage allowance", "All available fields"], "multi": true, "allowOther": true}
# NOTE: catalog_hints for ds-travel are hotel-flavored (Property, Room Type, Amenities...).
# None of those apply to airlines, so they were dropped entirely and replaced with real flight fields.

### Solution: ds-healthcare-providers | Entity: Hospitals
{"field": "attributes", "prompt": "Which hospital details do you need?", "choices": ["Bed count & departments", "Accreditation (NABH/JCI)", "Emergency number & opening hours", "Insurance / cashless panels", "Patient rating & reviews", "All available fields"], "multi": true, "allowOther": true}

### Solution: ds-healthcare-providers | Entity: Doctors
{"field": "attributes", "prompt": "Which doctor details do you need?", "choices": ["Speciality & council registration no.", "Consultation fee & mode", "Years of experience", "Affiliated hospital / clinic", "Patient rating & reviews", "All available fields"], "multi": true, "allowOther": true}
# NOTE: Bed Count and Departments (hospital-level fields) were dropped for the doctor entity.

### Firmographic company list — keep each dimension on its own question

Field extras.companyType | Entity: Companies | known: Technology / SaaS / India / Address, Phone
{"field": "extras.companyType", "prompt": "Which types of Indian SaaS companies should be included?", "choices": ["Public", "Private", "Startup", "All companies"], "multi": true, "allowOther": true}

Field extras.sizeFilter | Entity: Companies | known: Technology / SaaS / India
{"field": "extras.sizeFilter", "prompt": "Should this SaaS company list be filtered by size?", "choices": ["Filter by employee count", "Filter by annual revenue range", "No size filter"], "multi": true, "allowOther": true}

Field extras.listSize | Entity: Companies | known: Technology / SaaS / India
{"field": "extras.listSize", "prompt": "How many Indian SaaS companies do you want in the list?", "choices": ["Top 50", "Top 100", "Top 250", "Top 500", "All matching companies"], "multi": false, "allowOther": true}

Field sources | Entity: Companies | known: Technology / SaaS / India / Address, Phone
{"field": "sources", "prompt": "How should we get the list of Technology (SaaS) companies headquartered in India?", "choices": ["I'll upload a list", "Ask the Freda team to generate a list", "Get the list from Wikipedia or a third party"], "multi": false, "allowOther": true}
# NOTE: catalog source names (LinkedIn, company websites) are not choices here. This question is where the company list comes from.

### Solution: ds-automotive-network | Entity: Car Rentals
{"field": "attributes", "prompt": "Which car-rental details do you need?", "choices": ["Rental daily rate", "Rental fleet size & availability", "Pickup / drop-off location", "Vehicle model & fuel type", "Operator name & contact", "All available fields"], "multi": true, "allowOther": true}
# NOTE: On-road Price, Ex-showroom Price and Resale Estimate (purchase-oriented fields from the same
# Solution) were dropped since they don't apply to a rental entity.
"""


def compose_scope_question(payload: dict) -> tuple[dict | None, str]:
    """LLM-generated prompt/choices for one missing field. Falls back to None."""
    cfg = llm_config()
    if cfg is None:
        return None, "none"
    messages = [
        {"role": "system", "content": QUESTION_SYSTEM},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    try:
        try:
            response = cfg.client.chat.completions.create(
                model=cfg.model,
                response_format={"type": "json_object"},
                messages=messages,
                timeout=40,
            )
        except Exception:
            response = cfg.client.chat.completions.create(
                model=cfg.model,
                temperature=0.2,
                messages=messages,
                timeout=40,
            )
        content = response.choices[0].message.content or "{}"
        parsed = _parse_json(content)
    except Exception:
        return None, "none"
    if not isinstance(parsed, dict):
        return None, "none"
    field = str(parsed.get("field") or payload.get("field") or "").strip()
    prompt = str(parsed.get("prompt") or "").strip()
    choices = [str(item).strip() for item in (parsed.get("choices") or []) if str(item).strip()]
    if not field or not prompt:
        return None, "none"
    expected = str(payload.get("field") or "")
    if expected and field != expected:
        field = expected
    return {
        "field": field,
        "prompt": prompt,
        "choices": choices or list(payload.get("fallback_choices") or []),
        "multi": bool(parsed.get("multi")) if "multi" in parsed else bool(payload.get("multi")),
        "allowOther": parsed.get("allowOther", True),
    }, cfg.provider
