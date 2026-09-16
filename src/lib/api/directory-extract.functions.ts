import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { extractDirectoryListings } from "./directory-extract.core";

const Input = z.object({
  urls: z.array(z.string()).max(10),
  fields: z.array(z.string()).max(30),
  fieldMeta: z.record(z.string(), z.object({ label: z.string() })),
  entityLabel: z.string(),
});

export const runDirectoryExtraction = createServerFn({ method: "POST" })
  .inputValidator(Input)
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    return extractDirectoryListings(data.urls, data.fields, data.fieldMeta, data.entityLabel, apiKey, model);
  });
