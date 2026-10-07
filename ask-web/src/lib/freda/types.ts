import type { AgentRecord, SolutionRecord, SolutionSourceRecord } from "@/lib/catalog/types";

export type MatchKind = "existing" | "partial" | "none";

export type IntentFamily =
  | "healthcare"
  | "hospitality"
  | "travel"
  | "product"
  | "financial"
  | "firmographic"
  | "registry"
  | "jobs"
  | "legal"
  | "insurance"
  | "automotive"
  | "contacts"
  | "news"
  | "reviews"
  | "location"
  | "real_estate"
  | "generic";

export type ConversationPhase =
  | "idle"
  | "gathering"
  | "awaiting_path"
  | "confirming"
  | "estimated"
  | "submitted";

export type QueryKind = "metadata" | "requirement";

export interface Requirement {
  objective?: string;
  entityType?: string;
  industry?: string;
  subIndustry?: string;
  geography?: string;
  city?: string;
  country?: string;
  sources: string[];
  sourceUrls: string[];
  attributes: string[];
  frequency?: string;
  timePeriod?: string;
  volume?: string;
  recurring?: "one-time" | "recurring";
  productCategory?: string;
  extras: Record<string, string>;
}

export interface AgentHit {
  id: string;
  name: string;
  sourceUrl: string;
  category: string;
  industry: string;
  country: string;
  dataType: string;
  description: string;
  complexity: string;
  datapoints: string;
  project: string;
  estimatedRecords: string;
  score: number;
  reasons: string[];
}

export interface SolutionHit {
  id: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  coverage: string;
  accuracy: string;
  countriesCovered: string;
  refreshCadence: string;
  refreshOptions: string[];
  sourceCount: string;
  sourceNames: string[];
  attributeCount: string;
  attributes: string[];
  records: string;
  score: number;
  reasons: string[];
  relatedSources: SolutionSourceRecord[];
}

export interface Gap {
  field: string;
  detail: string;
}

export interface Estimate {
  volume: string;
  timeline: string;
  sources: string[];
  attributes: string[];
  refresh: string;
  geography: string;
  assumptions: string[];
  complexity: string;
}

export interface RequirementAnswer {
  field: string;
  prompt: string;
  answer: string;
}

export interface JobRecord {
  id: string;
  createdAt: string;
  status: "Pending Onboarding" | "Solution Requested" | string;
  title: string;
  requirement: Requirement;
  family: IntentFamily;
  estimate: Estimate;
  origin: "Ask Freda";
  answers?: RequirementAnswer[];
}

export interface ConversationState {
  phase: ConversationPhase;
  requirement: Requirement;
  askedFields: string[];
  family: IntentFamily;
  matchKind: MatchKind | null;
  agentHits: AgentHit[];
  solutionHits: SolutionHit[];
  gaps: Gap[];
  suggestedSources: SolutionSourceRecord[];
  estimate?: Estimate;
  jobId?: string;
  lastUserMessage?: string;
  buildNew?: boolean;
  answersLog?: RequirementAnswer[];
  pendingField?: string | null;
  pendingPrompt?: string | null;
  pendingChoices?: string[];
  pendingMulti?: boolean;
}

export type UserActionType =
  | "expand"
  | "build_new"
  | "use_existing"
  | "confirm"
  | "revise"
  | "submit_job"
  | "answer_question"
  | "suggest_sources"
  | "accept_sources";

export interface ChatCard {
  type:
    | "capabilities"
    | "gaps"
    | "path_options"
    | "questions"
    | "choice_question"
    | "summary"
    | "estimate"
    | "job"
    | "sources"
    | "metadata";
  title?: string;
  body?: string;
  agents?: AgentHit[];
  solutions?: SolutionHit[];
  gaps?: Gap[];
  questions?: string[];
  field?: string;
  choices?: string[];
  selected?: string[];
  multi?: boolean;
  allowOther?: boolean;
  options?: { id: UserActionType; label: string; href?: string }[];
  summary?: Record<string, string>;
  estimate?: Estimate;
  job?: JobRecord;
  sources?: SolutionSourceRecord[];
  metadata?: {
    kind: string;
    rows: { label: string; value: string }[];
    solutions?: SolutionRecord[];
    agents?: AgentRecord[];
  };
}

export interface ChatResponse {
  text: string;
  state: ConversationState;
  cards: ChatCard[];
}

export function emptyRequirement(): Requirement {
  return {
    sources: [],
    sourceUrls: [],
    attributes: [],
    extras: {},
  };
}

export function initialState(): ConversationState {
  return {
    phase: "idle",
    requirement: emptyRequirement(),
    askedFields: [],
    family: "generic",
    matchKind: null,
    agentHits: [],
    solutionHits: [],
    gaps: [],
    suggestedSources: [],
  };
}
