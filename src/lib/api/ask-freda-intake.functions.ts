import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getNextFollowUp, summarizeIntake } from "./ask-freda-intake.core";

// RPC boundary for the Ask FreDA intake flow's AI calls — same reasoning as
// monitoring-refresh.functions.ts: OPENAI_API_KEY only ever lives server-side.

const QaTurnSchema = z.object({ question: z.string(), answer: z.string() });

const IntakeContextSchema = z.object({
  requestType: z.enum(["Agent", "Solution"]),
  name: z.string(),
  industry: z.string(),
  geography: z.string(),
  qaHistory: z.array(QaTurnSchema).max(10),
});

function readAiConfig() {
  return { apiKey: process.env.OPENAI_API_KEY ?? "", model: process.env.OPENAI_MODEL ?? "gpt-4o-mini" };
}

export const getAskFredaFollowUp = createServerFn({ method: "POST" })
  .inputValidator(IntakeContextSchema)
  .handler(async ({ data }) => {
    const { apiKey, model } = readAiConfig();
    return getNextFollowUp(data, apiKey, model);
  });

export const getAskFredaIntakeSummary = createServerFn({ method: "POST" })
  .inputValidator(IntakeContextSchema)
  .handler(async ({ data }) => {
    const { apiKey, model } = readAiConfig();
    return summarizeIntake(data, apiKey, model);
  });
