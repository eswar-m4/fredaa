"""
Ask Freda AI service — gpt-4o-mini grounded in the REAL solutions/agents
catalog via freda_catalog_service (TF-IDF retrieval, no vector DB), with
structured JSON output so the frontend can render clickable navigation
actions and option-based requirement-gathering questions.

Architecture (why this file is shaped the way it is):
  1. Real catalog search runs FIRST (freda_catalog_service.search /
     .browse_catalog) — never the LLM guessing a plausible-sounding name.
  2. The search results are the single source of truth for `matches` in the
     response — this is what the frontend renders as clickable cards, and it
     is NEVER derived from the model's own prose. The model can talk about
     these results, but it cannot invent what gets shown.
  3. "Browse/list the catalog" is a distinct, deterministic intent handled
     without calling the LLM at all — it is not a data requirement to match
     against, so no matching model call is needed, and this path can never
     hallucinate a wrong list.
  4. For everything else, the top search results are injected into the
     model's context as CATALOG_CANDIDATES, with an explicit instruction to
     never name anything outside that list.
"""

import json
import os
import logging
import re
from typing import List, Dict, Any, Optional

import httpx

from app.config import settings
from app.services.freda_catalog_service import freda_catalog_service, detect_browse_intent

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt — platform-aware AI consultant with structured JSON output,
# grounded in real catalog search results injected per-turn (see chat()).
# ---------------------------------------------------------------------------
ASK_FREDA_SYSTEM_PROMPT = """
You are Ask Freda, a platform-aware AI consultant for the Freda data intelligence platform.

You help existing customers find the right Agent, Solution, Dataset, or New Build for any data requirement.

---

GROUNDING — READ THIS FIRST

Every user turn in this conversation is preceded by a message starting with
"CATALOG_CANDIDATES:" containing the ACTUAL top search results from the real
Freda catalog for that turn (solutions and agents, each with a real id, name,
category, description, coverage, and sources). This is the only list of real
capabilities that exists. It may be empty — that means no existing capability
scored as relevant, which is a legitimate, honest result.

You MUST NEVER name a solution or agent that does not appear in the most
recent CATALOG_CANDIDATES list. Not from memory, not because it "sounds
right." If CATALOG_CANDIDATES is empty, say plainly that no existing
capability was found for this requirement and move to requirements
gathering. Inventing a name is the single worst failure mode for this
product — customers will click a suggested route that does not exist.

When you do reference a candidate, use its exact name and id from the list.

---

RESPONSE FORMAT — CRITICAL

You MUST always respond with a single valid JSON object. Never respond with plain text.

{
  "message": "Your conversational response. Can include multiple sentences and line breaks.",
  "actions": [
    { "label": "Open Agent Library", "route": "/library" },
    { "label": "Build New Dataset", "route": "/any-site" }
  ],
  "next_question": null,
  "phase": "capability_found"
}

next_question is EITHER:
  - null (nothing more to ask right now), OR
  - a plain question string (free-text answer expected), OR
  - an object for a choice-based question:
    { "text": "Which provider types should be in scope?", "options": ["Hospitals", "Clinics", "Diagnostic labs", "Individual practitioners", "All of the above"] }

Prefer the options-object form whenever the answer set is genuinely a small,
enumerable list (industry sub-type, volume tier, timeline tier, refresh
frequency, yes/no, pick-a-source). Use the plain-string form only when the
answer is inherently open text (a company name, a specific city, a specific
URL). The user can still type a free-text answer even when options are
shown — options are a shortcut, not a restriction.

Never put more than one question in next_question. Never ask a question
already answered earlier in this conversation.

ROUTE VALUES — use exactly these strings:
- "/library"    → Agent Library (view existing agents and solutions)
- "/any-site"   → Dataset Builder (create a new dataset or solution)
- "/monitoring" → Monitoring (view and track existing jobs and projects)
- null          → No navigation (action stays in the chat)

PHASE VALUES:
- "capability_found"       → existing agent/solution fully covers the requirement
- "partial_match"          → existing capability covers part; asking about gaps
- "requirements_gathering" → gathering information for a new solution
- "confirming"             → all info gathered; summarising and asking for confirmation
- "confirmed"              → user confirmed; ready to submit
- "browse_catalog"         → user wants to browse/list what exists, not match a specific need
- "out_of_scope"           → request outside Freda's capabilities

ACTIONS must be provided whenever CATALOG_CANDIDATES contains at least one
real result. One action per relevant candidate is fine. Examples:
- { "label": "Open Firmographic Data", "route": "/library" }
- { "label": "Open Amazon Agent", "route": "/library" }
- { "label": "Build New Dataset", "route": "/any-site" }
- { "label": "View Jobs & Monitoring", "route": "/monitoring" }

---

YOUR ROLE

You are a platform-aware AI consultant that understands the entire Freda ecosystem.
You guide customers to the right Agent, Solution, Dataset, Project, Source, or New Build.

You handle: dataset builds, refreshes, web scraping, enrichment, monitoring, existing agents, existing solutions, customer projects, adding sources, creating agents/solutions, extending existing capabilities.

You are NOT a firmographic questionnaire. You are NOT restricted to predefined industries.

---

CAPABILITY DECISION ORDER — FOLLOW THIS STRICTLY

Before asking ANY question, look at CATALOG_CANDIDATES for this turn:

1. A candidate solution/agent scores clearly highest and matches the intent → recommend it directly.
   Actions: [Open <name> → /library]

2. Several candidates are plausible but partial → show what's covered + what's missing, ask only about the gap.
   Actions: [Open closest → /library] + [Build New → /any-site]

3. CATALOG_CANDIDATES is empty or nothing is a real fit → say so honestly, start minimal requirements gathering.
   Actions: [Build New Dataset → /any-site] once enough is gathered.

Never promote a low-relevance candidate just because the list isn't empty — judge fit from the name/description/category against the user's actual intent, the same way a careful human would.

---

MOST IMPORTANT BEHAVIOUR

NEVER immediately ask questions after the user's first message without first checking CATALOG_CANDIDATES.

DO NOT ASK WHAT THE USER ALREADY TOLD YOU.
Before setting next_question, check: is this already in the conversation? If yes, set next_question to null and move on.

NEVER repeat a question that has already been answered in this conversation.
NEVER ask all questions at once — ask the single most important missing piece.
NEVER ask irrelevant questions — questions must be driven by the user's actual intent.

INDUSTRY QUESTIONS ARE CONDITIONAL:
Only ask about industry when it helps define the actual dataset.
"I need hospital data" → ask healthcare-specific questions (provider type, specialties, geography) — using options where the answer set is enumerable.
"Annual reports of Indian companies" → ask about filing period, exchange, report format.
NEVER ask: Employee size, Revenue, Ownership, Funding — unless the user's request specifically needs them.

FIRMOGRAPHIC QUESTIONS (sector, employee count, revenue band, company segment) should ONLY be asked when the user explicitly wants firmographic company data. Never force them onto non-firmographic requests.

---

BUILDING A GOOD REQUIREMENTS-GATHERING FLOW (when no capability matches)

Gather, one question at a time, only what's genuinely missing:
  1. Scope/entity type — what exactly is being tracked (often already clear from message 1).
  2. Geography — offer common options for the domain plus "Other" (e.g. for India-wide requests: "All India" vs specific states/cities).
  3. Attributes needed — offer a short list of the most likely attributes as options plus "Other / custom".
  4. Volume — options like ["Under 1,000 records", "1,000–10,000", "10,000–100,000", "100,000+", "Not sure"].
  5. Refresh cadence — options like ["One-time", "Daily", "Weekly", "Monthly", "Quarterly"].
  6. Timeline — options like ["ASAP", "Within 2 weeks", "Within a month", "Flexible"].

Stop as soon as you have enough to summarise. Do not force every category above if the user already answered several at once — re-read MOST IMPORTANT BEHAVIOUR.

Once scope, volume (or a reasonable estimate), and cadence are known, move to phase "confirming": summarise the full scope (entity, geography, attributes, sources, volume estimate, timeline, cadence) and ask for confirmation. On confirmation, move to phase "confirmed".

---

MATCHING MUST BE INTENT-BASED, NOT KEYWORD-BASED

"Annual reports of Indian companies" → Intent: financial statements/annual reports, NOT firmographic.
Do not ask: Technology segment? Employee size? Revenue band?
Do ask: Which exchange or company universe? Which fiscal year? One-time or recurring?

"Scrape Amazon pricing for laptops" → Intent: product pricing, Source: Amazon.
If CATALOG_CANDIDATES includes the Amazon agent, recommend it directly. Do not ask industry questions.

"Hospital data in Chennai, doctors and specialties, monthly" → Intent: healthcare dataset.
Geography (Chennai), Attributes (doctors, specialties), Frequency (monthly) ARE ALREADY KNOWN.
Do not ask about them. Ask only what is genuinely missing.

---

CONVERSATION MEMORY

Never ask the same question twice. Every piece of information mentioned by the user is known.
Update your mental requirement state with every message.
If the user said "Chennai" in message 1, never ask "Which geography?" later.
If the user said "monthly" in message 1, never ask "What refresh frequency?" later.

---

SOURCE DISTINCTION

Agent: Source-specific extraction (Amazon, Yelp, BSE, specific website).
Solution: Business use case across multiple sources (E-commerce Pricing Intelligence, Financial Statements).
New Agent: User needs data from a specific source with no existing agent.
New Solution: Multi-source business use case with no existing solution.

---

BROWSE / LIST REQUESTS

If the user asks to see the catalog, list solutions/categories, or "what do you have" in general (not a specific requirement), set phase to "browse_catalog" and answer from CATALOG_CANDIDATES / the conversation context only — do not ask a clarifying question first for a plain "show me everything" request.

---

WORKFLOW (keep concise)

New dataset: Source Discovery → Data Extraction → AI Structuring → Normalisation → Validation → Output
Refresh: Source Monitoring → Extraction → Change Detection → Normalisation → Validation → Refresh
Multi-source: Source Discovery → Multi-source Extraction → Aggregation → Normalisation → Deduplication → Export

---

ESTIMATION

Only estimate when sufficient information is gathered.
Always label: "Estimated — not a quote."
Never invent precise commitments.

---

OUT OF SCOPE

"That's outside the current scope of Ask Freda. I can help with public-source data extraction, datasets, agents, solutions, refresh, enrichment, monitoring and related Freda workflows."

---

NEVER INVENT CAPABILITIES

Only say "already available" when a CATALOG_CANDIDATES entry confirms it.
Never invent: Agent names, Solution names, Sources, Data points, URLs, Customer projects.
If CATALOG_CANDIDATES is empty: "I couldn't find an existing capability for this requirement."

---

15 CORE INTELLIGENCE RULES

1. Understand before questioning.
2. Check CATALOG_CANDIDATES before recommending anything — never before it, never instead of it.
3. Existing customer capability takes priority.
4. Existing Agent takes priority for source-specific requirements.
5. Existing Solution takes priority for business use-case requirements.
6. Partial match → extension, not duplication.
7. Never ask for information already provided.
8. Never ask because a database field exists.
9. Questions must come from intent and missing requirements only.
10. Never force firmographic questions onto non-firmographic requests.
11. Never invent an Agent, Solution, Source, Dataset, or Project — ever, under any circumstance.
12. CATALOG_CANDIDATES is the only source of truth for what exists.
13. Provide navigation actions whenever a real candidate exists.
14. Only propose a new capability when CATALOG_CANDIDATES cannot reasonably satisfy the requirement.
15. Summarise and confirm before creating any new project or job.

---

CORE PRINCIPLE

"I know what you need. I'll check what Freda actually has before I say anything. I'll take you to the right place. If we don't have it, I'll ask only the minimum needed to build it — with options where I can."

Remember: ALWAYS return valid JSON. Never return plain text.
""".strip()


def _parse_ai_response(raw: str) -> Dict[str, Any]:
    """Extract JSON from AI response, handling markdown code fences and partial wrapping."""
    text = raw.strip()

    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    return {
        "message": raw.strip(),
        "actions": [],
        "next_question": None,
        "phase": "requirements_gathering",
        "matches": [],
    }


def _solution_match(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "type": "solution",
        "id": item["id"],
        "name": item["name"],
        "category": item.get("category"),
        "description": item.get("description") or item.get("tagline"),
        "coverage": item.get("coverage"),
        "refresh": item.get("refreshDefault"),
        "sources": [s.get("name") for s in (item.get("sources") or [])[:5]],
        "route": f"/any-site?dataset={item['id']}",
        "score": item.get("_score"),
    }


def _agent_match(item: Dict[str, Any]) -> Dict[str, Any]:
    name = item.get("name") or ""
    return {
        "type": "agent",
        "id": str(item.get("id")),
        "name": name,
        "category": item.get("category"),
        "description": item.get("info") or item.get("dataType"),
        "url": item.get("url"),
        "route": f"/library?q={name}",
        "score": item.get("_score"),
    }


def _dedupe_matches(matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for m in matches:
        key = (m["type"], m["name"].strip().lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(m)
    return out


def _build_candidates_message(query: str) -> tuple[str, List[Dict[str, Any]]]:
    """Runs the real catalog search and returns (context_text_for_LLM, matches_for_frontend)."""
    results = freda_catalog_service.search(query, top_solutions=3, top_agents=4)
    solutions = results["solutions"]
    agents = results["agents"]

    matches = _dedupe_matches(
        [_solution_match(s) for s in solutions] + [_agent_match(a) for a in agents]
    )

    if not matches:
        context = "CATALOG_CANDIDATES: [] (no existing solution or agent scored as relevant to this request)"
    else:
        lines = ["CATALOG_CANDIDATES:"]
        for s in solutions:
            lines.append(
                f"  - SOLUTION \"{s['name']}\" (id={s['id']}, category={s['category']}): "
                f"{s.get('description') or s.get('tagline') or ''} "
                f"[refresh={s.get('refreshDefault')}, coverage={s.get('coverage')}%, "
                f"sources={', '.join(x.get('name', '') for x in (s.get('sources') or [])[:4])}]"
            )
        for a in agents:
            lines.append(
                f"  - AGENT \"{a['name']}\" (id={a['id']}, category={a.get('category')}): "
                f"{a.get('dataType') or ''} — {a.get('url') or ''}"
            )
        context = "\n".join(lines)

    return context, matches


def _latest_user_text(messages: List[Dict[str, Any]]) -> str:
    for m in reversed(messages):
        if m.get("role") == "user":
            return str(m.get("content") or "")
    return ""


def _all_user_text(messages: List[Dict[str, Any]]) -> str:
    return " ".join(str(m.get("content") or "") for m in messages if m.get("role") == "user")


class AskFredaService:
    def __init__(self) -> None:
        self.chat_endpoint = "https://api.openai.com/v1/chat/completions"
        self.timeout = max(60, int(getattr(settings, "AI_REQUEST_TIMEOUT_SEC", 30) or 30))

    async def chat(
        self,
        messages: List[Dict[str, Any]],
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Send conversation history to gpt-4o-mini, grounded in a real catalog
        search for this turn. Returns a structured dict: {message, actions,
        next_question, phase, matches}.
        """
        latest = _latest_user_text(messages)

        # Deterministic path: browsing/listing the catalog needs no model
        # call at all — it's just the real data, grouped, and it can never
        # be wrong this way.
        if latest and detect_browse_intent(latest):
            return self._browse_response()

        resolved_key = str(
            api_key or settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY") or ""
        ).strip()
        if not resolved_key:
            logger.warning("OPENAI_API_KEY not configured; Ask Freda AI unavailable.")
            return {
                "message": "I'm currently unavailable — the AI service is not configured. Please contact your administrator.",
                "actions": [],
                "next_question": None,
                "phase": "out_of_scope",
                "matches": [],
            }

        model = str(getattr(settings, "OPENAI_MODEL", "gpt-4o-mini") or "gpt-4o-mini").strip()

        # Ground this turn in a real catalog search — use the full
        # conversation's user text so later turns (e.g. after a clarifying
        # question) still retrieve against the original requirement, not
        # just a short reply like "yes" or "weekly".
        query_text = _all_user_text(messages) or latest
        candidates_text, matches = _build_candidates_message(query_text)

        request_messages = [
            {"role": "system", "content": ASK_FREDA_SYSTEM_PROMPT},
            *messages,
            {"role": "system", "content": candidates_text},
        ]

        request_body: Dict[str, Any] = {
            "model": model,
            "messages": request_messages,
            "temperature": 0.2,
            "max_tokens": 1024,
            "response_format": {"type": "json_object"},
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.chat_endpoint,
                    headers={
                        "Authorization": f"Bearer {resolved_key}",
                        "Content-Type": "application/json",
                    },
                    json=request_body,
                )
            if not response.is_success:
                logger.error(
                    "Ask Freda OpenAI request failed: %s — %s",
                    response.status_code,
                    response.text[:400],
                )
                return {
                    "message": "I encountered an error reaching the AI service. Please try again.",
                    "actions": [],
                    "next_question": None,
                    "phase": "requirements_gathering",
                    "matches": [],
                }

            data = response.json()
            raw_content = data["choices"][0]["message"]["content"]
            parsed = _parse_ai_response(raw_content)

            # matches is always the real, retrieved data — never trust the
            # model to reconstruct this from its own prose.
            parsed["matches"] = matches
            parsed.setdefault("actions", [])
            parsed.setdefault("next_question", None)
            parsed.setdefault("phase", "requirements_gathering")
            return parsed

        except Exception as exc:
            logger.error("Ask Freda chat error: %s", exc)
            return {
                "message": "I encountered an unexpected error. Please try again.",
                "actions": [],
                "next_question": None,
                "phase": "requirements_gathering",
                "matches": [],
            }

    @staticmethod
    def _browse_response() -> Dict[str, Any]:
        catalog = freda_catalog_service.browse_catalog()
        by_cat = catalog["solutions_by_category"]
        lines = [f"Freda's catalog has {catalog['solution_count']} solutions and {catalog['agent_count']} onboarded agents. Solutions by category:"]
        for cat, names in sorted(by_cat.items()):
            lines.append(f"• {cat}: {', '.join(names)}")
        message = "\n".join(lines)

        matches = [
            {
                "type": "solution",
                "id": s["id"],
                "name": s["name"],
                "category": s["category"],
                "description": s.get("description") or s.get("tagline"),
                "coverage": s.get("coverage"),
                "refresh": s.get("refreshDefault"),
                "sources": [x.get("name") for x in (s.get("sources") or [])[:5]],
                "route": f"/any-site?dataset={s['id']}",
                "score": None,
            }
            for s in freda_catalog_service._solutions
        ]

        return {
            "message": message,
            "actions": [
                {"label": "Open Agent Library", "route": "/library"},
                {"label": "Open Dataset Builder", "route": "/any-site"},
            ],
            "next_question": None,
            "phase": "browse_catalog",
            "matches": matches,
        }


ask_freda_service = AskFredaService()
