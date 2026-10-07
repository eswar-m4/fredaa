import { loadCatalog } from "@/lib/catalog/load";
import type { Catalog } from "@/lib/catalog/types";
import { classifyQuery, extractRequirement, familyFromRequirement } from "./extract";
import { matchRequirement, suggestSources } from "./match";
import { applyAnswer, isRequirementComplete, nextQuestions } from "./questions";
import { createJob } from "@/lib/jobs";
import { useExistingPathOptions } from "./capability-link";
import type {
  ChatCard,
  ChatResponse,
  ConversationState,
  Estimate,
  IntentFamily,
  Requirement,
  UserActionType,
} from "./types";
import { initialState } from "./types";

const YES = /^(yes|yep|yeah|y|correct|confirm|looks good|looks correct|that's right|that is right|ok|okay)\b/i;
const NO = /^(no|nope|change|edit|wrong|revise)\b/i;

function timelineFor(family: IntentFamily, complexity: string, kind: ConversationState["matchKind"]): string {
  if (kind === "existing") return "Ready to run on the existing capability — typically same-day to 2 business days to schedule.";
  if (kind === "partial") {
    if (/complex/i.test(complexity)) return "About 2–4 weeks to extend the existing capability.";
    return "About 5–10 business days to extend the existing capability.";
  }
  if (/complex/i.test(complexity)) return "About 3–4 weeks for a new Agent, or 4–6 weeks if a new packaged Solution is required.";
  if (/simple/i.test(complexity)) return "About 3–5 business days for a new Agent.";
  return "About 1–2 weeks for a new Agent, longer if a multi-source Solution is required.";
}

function buildEstimate(state: ConversationState): Estimate {
  const solution = state.solutionHits[0];
  const agent = state.agentHits[0];
  const complexity = agent?.complexity || (state.matchKind === "none" ? "Medium" : "Medium");
  const volume =
    solution?.records ||
    agent?.estimatedRecords ||
    "Volume will be confirmed during onboarding from the selected sources.";
  const sources =
    state.requirement.sources.length > 0
      ? state.requirement.sources
      : state.suggestedSources.map((source) => source.name).slice(0, 6);
  const attributes =
    state.requirement.attributes.length > 0
      ? state.requirement.attributes
      : solution?.attributes.slice(0, 8) ?? [];
  const assumptions = [
    "Estimates use catalog metadata for the matched capability only — not platform-wide coverage or accuracy.",
    "Pricing is outside this Ask Freda flow.",
  ];
  if (state.gaps.length) {
    assumptions.push("Gaps noted earlier still need Solutions/Admin confirmation during onboarding.");
  }
  return {
    volume,
    timeline: timelineFor(state.family, complexity, state.matchKind),
    sources: sources.length ? sources : ["To be confirmed from the catalog during onboarding"],
    attributes: attributes.length ? attributes : ["To be confirmed"],
    refresh: state.requirement.frequency || solution?.refreshCadence || "To be confirmed",
    geography: state.requirement.geography || state.requirement.country || "Not specified",
    assumptions,
    complexity,
  };
}

function summaryMap(req: Requirement, family: IntentFamily): Record<string, string> {
  const rows: Record<string, string> = {};
  if (req.entityType) rows.Entity = req.entityType;
  const category = [req.industry, req.subIndustry].filter(Boolean).join(" / ");
  if (category) rows.Category = category;
  if (req.geography || req.country) rows.Geography = req.geography || req.country || "";
  if (req.attributes.length) rows["Required data"] = req.attributes.join(", ");
  if (req.sources.length) rows.Sources = req.sources.join(", ");
  else if (req.extras.sourcesDeferred === "true") rows.Sources = "Suitable public / catalog sources";
  if (req.frequency || req.recurring) rows.Frequency = req.frequency || req.recurring || "";
  if (req.volume) rows.Volume = req.volume;
  return Object.keys(rows).length ? rows : { Requirement: req.objective || family };
}

function metadataResponse(text: string, catalog: Catalog, state: ConversationState): ChatResponse {
  const q = text.toLowerCase();
  const cards: ChatCard[] = [];
  let body = "";

  if (/sheet/.test(q)) {
    body = `The catalog workbook contains ${catalog.sheets.length + 4} sheets used by Ask Freda.`;
    cards.push({
      type: "metadata",
      title: "Catalog sheets",
      metadata: {
        kind: "sheets",
        rows: [
          { label: "Overview", value: "Counts and sheet legend" },
          { label: "Agents Catalog", value: `${catalog.agents.length} extraction agents` },
          { label: "Solutions Catalog", value: `${catalog.solutions.length} packaged data solutions` },
          { label: "Solution Sources", value: `${catalog.sources.length} source rows` },
          ...catalog.sheets.map((sheet) => ({ label: sheet.name, value: sheet.contents })),
        ],
      },
    });
  } else if (/solution/.test(q)) {
    body = `There are ${catalog.solutions.length} packaged Solutions across ${catalog.solutionsByCategory.length} categories. Figures below are per Solution, not platform-wide.`;
    cards.push({
      type: "metadata",
      title: "Solutions catalogue",
      metadata: {
        kind: "solutions",
        rows: catalog.solutionsByCategory.map((facet) => ({
          label: facet.name,
          value: `${facet.count} solution${facet.count === 1 ? "" : "s"}`,
        })),
        solutions: catalog.solutions,
      },
    });
  } else if (/how many/.test(q) && /agent/.test(q)) {
    body = `The Agent catalog currently has ${catalog.agents.length} extraction agents.`;
    cards.push({
      type: "metadata",
      title: "Agents by category",
      metadata: {
        kind: "facets",
        rows: catalog.agentsByCategory.map((facet) => ({
          label: facet.name,
          value: String(facet.count),
        })),
      },
    });
  } else if (/category/.test(q) && /agent/.test(q)) {
    body = "Agent counts by category from the catalog:";
    cards.push({
      type: "metadata",
      title: "Agents by category",
      metadata: {
        kind: "facets",
        rows: catalog.agentsByCategory.map((facet) => ({
          label: facet.name,
          value: String(facet.count),
        })),
      },
    });
  } else {
    body = catalog.overview.map((stat) => `${stat.label}: ${stat.value}`).join("\n");
    cards.push({
      type: "metadata",
      title: "Catalog overview",
      metadata: {
        kind: "overview",
        rows: [
          ...catalog.overview.map((stat) => ({ label: stat.label, value: stat.value })),
          { label: "Generated", value: catalog.generated || "Not specified" },
        ],
      },
    });
  }

  return { text: body, state: { ...state, phase: "idle" }, cards };
}

function pathOptionCard(state: ConversationState): ChatCard {
  return {
    type: "path_options",
    title: "How do you want to proceed?",
    options: [
      ...useExistingPathOptions(state.solutionHits, "Use this capability", state.agentHits),
      { id: "expand", label: "Customize / Extend" },
      { id: "build_new", label: "Create new scope" },
    ],
  };
}

function existingCards(state: ConversationState): ChatCard[] {
  const cards: ChatCard[] = [
    {
      type: "capabilities",
      title: "Existing capability found",
      body: "Reuse this rather than building a duplicate.",
      agents: state.agentHits,
      solutions: state.solutionHits,
    },
  ];
  if (state.gaps.length) {
    cards.push({
      type: "gaps",
      title: "Catalog notes",
      gaps: state.gaps,
    });
  }
  cards.push(pathOptionCard(state));
  return cards;
}

function partialCards(state: ConversationState): ChatCard[] {
  const cards: ChatCard[] = [
    {
      type: "capabilities",
      title: "Existing capability (partial match)",
      agents: state.agentHits,
      solutions: state.solutionHits,
    },
  ];
  if (state.gaps.length) {
    cards.push({
      type: "gaps",
      title: "Gaps versus your requirement",
      gaps: state.gaps,
    });
  }
  cards.push(pathOptionCard(state));
  return cards;
}

function confirmCards(state: ConversationState): ChatCard[] {
  return [
    {
      type: "summary",
      title: "Proposed requirement",
      summary: summaryMap(state.requirement, state.family),
      options: [
        { id: "confirm", label: "Submit request" },
        { id: "revise", label: "Edit scope" },
      ],
    },
  ];
}

function gather(state: ConversationState, catalog: Catalog): ChatResponse {
  if (state.requirement.extras.sourcesDeferred === "true" && state.suggestedSources.length === 0) {
    const suggested = suggestSources(
      state.requirement,
      catalog,
      state.solutionHits.map((hit) => hit.id),
    );
    if (suggested.length) {
      const next = {
        ...state,
        suggestedSources: suggested,
        phase: "gathering" as const,
        askedFields: [...state.askedFields, "sources"],
      };
      return {
        text: "I can suggest sources that are already in the catalog. Review these before we continue — I will not invent sources that are not indexed.",
        state: next,
        cards: [
          {
            type: "sources",
            title: "Suggested sources from the catalog",
            sources: suggested,
            options: [{ id: "accept_sources", label: "Use these sources" }],
          },
        ],
      };
    }
  }

  if (isRequirementComplete(state.family, state.requirement)) {
    const next = { ...state, phase: "confirming" as const };
    return {
      text: "I have enough to propose the requirement. Does this look correct?",
      state: next,
      cards: confirmCards(next),
    };
  }

  const questions = nextQuestions(state.family, state.requirement, state.askedFields, 1);
  if (!questions.length) {
    const next = { ...state, phase: "confirming" as const };
    return {
      text: "I have enough to propose the requirement. Does this look correct?",
      state: next,
      cards: confirmCards(next),
    };
  }

  const next = {
    ...state,
    phase: "gathering" as const,
    askedFields: [...state.askedFields, questions[0].field],
  };
  return {
    text: questions[0].prompt,
    state: next,
    cards: [{ type: "questions", questions: questions.map((question) => question.prompt) }],
  };
}

function startRequirement(text: string, state: ConversationState, catalog: Catalog): ChatResponse {
  const requirement = extractRequirement(text, catalog, state.phase === "idle" ? undefined : state.requirement);
  const family = familyFromRequirement(requirement, text);
  const matched = matchRequirement(text, requirement, catalog);
  const next: ConversationState = {
    ...state,
    requirement,
    family,
    matchKind: matched.kind,
    agentHits: matched.agents,
    solutionHits: matched.solutions,
    gaps: matched.gaps,
    lastUserMessage: text,
  };

  if (matched.kind === "existing") {
    next.phase = "awaiting_path";
    const primary = matched.agents[0]?.name || matched.solutions[0]?.name;
    const note = matched.gaps.length ? `\n\n${matched.gaps.map((gap) => `Note: ${gap.detail}`).join("\n")}` : "";
    return {
      text: `Existing capability found. ${primary} already covers this requirement, so you do not need to build something new. You can use this capability or build a new requirement.${note}`,
      state: next,
      cards: existingCards(next),
    };
  }

  if (matched.kind === "partial") {
    next.phase = "awaiting_path";
    const available = matched.solutions[0]?.tagline || matched.agents[0]?.dataType || "Related catalog coverage";
    return {
      text: `I found a related capability, but it does not fully satisfy the request.\n\nWhat is available: ${available}\n${matched.gaps.map((gap) => `Gap: ${gap.detail}`).join("\n")}`,
      state: next,
      cards: partialCards(next),
    };
  }

  next.phase = "gathering";
  const intro =
    "I couldn't find an existing capability that fully matches your requirement. I can help define a new data scope. I will only ask for details that are still missing.";
  const gathered = gather(next, catalog);
  return { ...gathered, text: `${intro}\n\n${gathered.text}` };
}

export function handleChat(
  message: string,
  incoming: ConversationState | null,
  action?: UserActionType,
): ChatResponse {
  const catalog = loadCatalog();
  const state = incoming ?? initialState();
  const text = message.trim();

  if (action === "use_existing") {
    const primary = state.solutionHits[0]?.name || state.agentHits[0]?.name || "this catalog capability";
    return {
      text: `${primary} already covers this. Open it from the card to use it as-is.`,
      state: { ...state, phase: "idle" as const, matchKind: "existing" as const },
      cards: [
        {
          type: "capabilities",
          title: "Existing capability found",
          body: "Reuse this rather than building a duplicate.",
          agents: state.agentHits,
          solutions: state.solutionHits,
        },
      ],
    };
  }

  if (action === "expand" || action === "build_new") {
    const next = {
      ...state,
      phase: "gathering" as const,
      matchKind: action === "build_new" ? ("none" as const) : state.matchKind,
    };
    if (action === "build_new") {
      next.agentHits = [];
      next.solutionHits = [];
    }
    const gathered = gather(next, catalog);
    const lead =
      action === "expand"
        ? "We'll customize the existing capability. I only need the details that are still missing."
        : "I couldn't find an existing Freda capability that fully matches your requirement. I can help define this as a new data scope.";
    return { ...gathered, text: `${lead}\n\n${gathered.text}` };
  }

  if (action === "suggest_sources") {
    const suggested = suggestSources(
      state.requirement,
      catalog,
      state.solutionHits.map((hit) => hit.id),
    );
    const next = {
      ...state,
      suggestedSources: suggested,
      requirement: {
        ...state.requirement,
        extras: { ...state.requirement.extras, sourcesDeferred: "true" },
      },
    };
    if (!suggested.length) {
      const next = {
        ...state,
        suggestedSources: [],
        requirement: {
          ...state.requirement,
          extras: { ...state.requirement.extras, sourcesDeferred: "true" },
        },
        askedFields: state.askedFields.includes("sources")
          ? state.askedFields
          : [...state.askedFields, "sources"],
      };
      const gathered = gather(next, catalog);
      return {
        ...gathered,
        text: `There are no catalog sources I can safely suggest for this requirement, so I will not invent URLs.\n\n${gathered.text}`,
      };
    }
    return {
      text: "Suggested sources from the current catalog. Confirm if these should be used.",
      state: next,
      cards: [
        {
          type: "sources",
          title: "Suggested sources",
          sources: suggested,
          options: [{ id: "accept_sources", label: "Use these sources" }],
        },
      ],
    };
  }

  if (action === "accept_sources") {
    const names = state.suggestedSources.map((source) => source.name);
    const nextReq = {
      ...state.requirement,
      sources: Array.from(new Set([...state.requirement.sources, ...names])),
      extras: { ...state.requirement.extras, sourcesDeferred: "true" },
    };
    return gather({ ...state, requirement: nextReq, askedFields: [...state.askedFields, "sources"] }, catalog);
  }

  if (action === "confirm" || (state.phase === "confirming" && YES.test(text))) {
    const estimate = buildEstimate(state);
    const next = { ...state, phase: "estimated" as const, estimate };
    return {
      text: "Requirement confirmed. Here is the proposed build information. Pricing stays outside this conversation.",
      state: next,
      cards: [
        {
          type: "estimate",
          title: "Estimate & proposed solution",
          estimate,
          options: [{ id: "submit_job", label: "Create job / send to onboarding" }],
        },
      ],
    };
  }

  if (action === "revise" || (state.phase === "confirming" && NO.test(text))) {
    const next = { ...state, phase: "gathering" as const, askedFields: [] };
    const gathered = gather(next, catalog);
    return { ...gathered, text: `Tell me what to change, or answer the next missing detail.\n\n${gathered.text}` };
  }

  if (action === "submit_job" || (state.phase === "estimated" && /submit|create job|onboard/i.test(text))) {
    const estimate = state.estimate ?? buildEstimate(state);
    const job = createJob({
      title: state.requirement.entityType || state.requirement.objective || "Ask Freda requirement",
      requirement: state.requirement,
      family: state.family,
      estimate,
    });
    const next = { ...state, phase: "submitted" as const, jobId: job.id, estimate };
    return {
      text: `Job ${job.id} created and marked Pending Onboarding. Track it in Monitoring. The Solutions team will complete Agent/Solution setup outside this chat.`,
      state: next,
      cards: [{ type: "job", title: "Pending onboarding", job }],
    };
  }

  if (!text) {
    return { text: "Describe the dataset you need in plain English.", state, cards: [] };
  }

  if (classifyQuery(text) === "metadata" && (state.phase === "idle" || state.phase === "submitted")) {
    return metadataResponse(text, catalog, state);
  }

  if (state.phase === "awaiting_path") {
    if (/build new|new requirement|new dataset|new scope|create new/i.test(text)) return handleChat(text, state, "build_new");
    if (/customize|extend|customise/i.test(text)) return handleChat(text, state, "expand");
    if (/use (this|existing)|open existing|existing|without the missing/i.test(text)) {
      return handleChat(text, state, "use_existing");
    }
  }

  if (state.phase === "gathering") {
    const lastField = state.askedFields[state.askedFields.length - 1];
    let requirement = extractRequirement(text, catalog, state.requirement);
    if (lastField) requirement = applyAnswer(requirement, lastField, text);
    if (/suggest (sources|source)/i.test(text)) {
      return handleChat(text, { ...state, requirement }, "suggest_sources");
    }
    return gather({ ...state, requirement, family: familyFromRequirement(requirement, text) }, catalog);
  }

  if (state.phase === "estimated") {
    if (YES.test(text) || /job|onboard|submit/i.test(text)) return handleChat(text, state, "submit_job");
  }

  return startRequirement(text, initialState(), catalog);
}
