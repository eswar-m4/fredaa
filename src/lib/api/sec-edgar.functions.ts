import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchSecEdgarProfile } from "./sec-edgar.core";

// RPC boundary — SEC's endpoints are public/CORS-friendly, but this stays
// server-side for consistency with the rest of the live-refresh plumbing
// (and so the required contact User-Agent lives in one place).
export const runSecEdgarLookup = createServerFn({ method: "POST" })
  .inputValidator(z.object({ companyName: z.string() }))
  .handler(async ({ data }) => {
    return fetchSecEdgarProfile(data.companyName);
  });
