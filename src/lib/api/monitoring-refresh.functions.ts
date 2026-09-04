import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { runFullRefresh } from "./monitoring-refresh.core";

// Real, live refresh, shared by every project that's been onboarded with
// real per-record URLs (NTM Monitoring, NTM POI, …): visits each record's
// own website (server-side, so there's no browser CORS restriction),
// re-extracts every tracked attribute via OpenAI (OPENAI_API_KEY /
// OPENAI_MODEL), and diffs each field against the value currently on file —
// the same idea as backend/scripts/monitoring_refresh/refresh-monitoring-sheet.ts
// (the CLI version, which uses Gemini), exposed here as a click-to-run server
// function so results can be shown in the Review popup as Old → New, tagged
// Added / Deleted / Modified / Verified.
//
// Each project supplies its own PromptConfig (field meanings/groups, entity
// language, subpage keywords) from src/lib/live-refresh-profiles.ts — the
// actual fetch/prompt/diff logic in ./monitoring-refresh.core.ts is generic.
// This file is just the RPC boundary.

export type { ChangeType, FieldDiff, HotelRefreshResult, RefreshOutcome, PromptConfig, FieldMeta } from "./monitoring-refresh.core";

const Target = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  currentValues: z.record(z.string(), z.string()),
});

const FieldMetaSchema = z.object({
  group: z.string(),
  label: z.string(),
  indicator: z.boolean().optional(),
});

const PromptConfigSchema = z.object({
  entityLabel: z.string(),
  fieldMeta: z.record(z.string(), FieldMetaSchema),
  relevantLinkKeywords: z.array(z.string()),
});

const Input = z.object({
  config: PromptConfigSchema,
  targets: z.array(Target).max(200),
  fields: z.array(z.string()).max(300),
});

export const runMonitoringRefresh = createServerFn({ method: "POST" })
  .inputValidator(Input)
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    return runFullRefresh(data.config, data.targets, data.fields, apiKey, model, 3);
  });
