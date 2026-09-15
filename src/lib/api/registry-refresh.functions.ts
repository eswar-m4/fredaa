import { createServerFn } from "@tanstack/react-start";
import { fetchEcaOnLive, fetchMeatListLive } from "./registry-refresh.core";

// RPC boundary — the ArcGIS endpoint is public/CORS-open, but this stays
// server-side for consistency with the rest of the live-refresh plumbing.
export const runEcaOnRegistryRefresh = createServerFn({ method: "POST" }).handler(async () => {
  return fetchEcaOnLive(25);
});

// Same idea for CFIA's MeatList app — public/CORS-open HTML, kept
// server-side for consistency.
export const runMeatListRegistryRefresh = createServerFn({ method: "POST" }).handler(async () => {
  return fetchMeatListLive();
});
