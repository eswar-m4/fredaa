// Cross-check a discovered URL against what is already onboarded in the portal,
// so the assistant can flag "already available" instead of proposing it as new.
import botsData from "@/data/bots.json";
import { DATASETS } from "@/data/datasets";

export type OnboardedHit = {
  where: "Agents" | "Solutions";
  label: string; // agent or dataset name
  href: string;
};

function host(value: string) {
  if (!value) return "";
  let v = String(value).trim().toLowerCase();
  v = v.replace(/^https?:\/\//, "").replace(/^www\./, "");
  v = v.split("/")[0].split("?")[0];
  return v;
}

type RawBot = { name?: string; url?: string; category?: string };

let index: Map<string, OnboardedHit> | null = null;

function buildIndex() {
  const map = new Map<string, OnboardedHit>();
  const bots = ((botsData as { bots?: RawBot[] }).bots || []) as RawBot[];
  for (const bot of bots) {
    const h = host(String(bot.url || ""));
    if (!h) continue;
    if (!map.has(h)) {
      map.set(h, { where: "Agents", label: String(bot.name || h), href: "/site-specific" });
    }
  }
  for (const ds of DATASETS) {
    for (const src of ds.sources || []) {
      const h = host(String(src.url || ""));
      if (!h || h.includes("{")) continue;
      if (!map.has(h)) {
        map.set(h, { where: "Solutions", label: ds.name, href: "/any-site" });
      }
    }
  }
  return map;
}

export function lookupOnboarded(url: string): OnboardedHit | null {
  if (!index) index = buildIndex();
  const h = host(url);
  if (!h) return null;
  const direct = index.get(h);
  if (direct) return direct;
  // match on the registrable-ish root (practo.com matches www.practo.com/chennai)
  const parts = h.split(".");
  if (parts.length > 2) {
    const root = parts.slice(-2).join(".");
    return index.get(root) || null;
  }
  return null;
}

export function onboardedCount() {
  if (!index) index = buildIndex();
  return index.size;
}
