import { apiFetch } from "@/lib/api";

export type BotCatalogEntry = {
  id: string | number;
  name?: string;
  url?: string;
  project?: string;
  type?: string;
  industry?: string;
  country?: string;
  dataType?: string;
  info?: string;
  category?: string;
  complexity?: string;
  datapoints?: number;
  catalog_kind?: string;
  source_key?: string;
  package_path?: string | null;
  package_files?: unknown[];
  request_id?: string | null;
  job_id?: string | null;
  active?: boolean;
  [key: string]: unknown;
};

export type BotCatalogResponse = {
  success?: boolean;
  bots: BotCatalogEntry[];
  categoryCounts: Record<string, number>;
  total: number;
};

export async function fetchBotCatalog(): Promise<BotCatalogResponse> {
  const response = await apiFetch("/api/v1/bots");
  const body = (await response.json().catch(() => null)) as BotCatalogResponse | null;
  if (!response.ok || !body) {
    throw new Error((body as { detail?: string } | null)?.detail || "Failed to load bot catalog");
  }
  return body;
}

function cleanSourceName(name: string) {
  if (!name) return "";
  let clean = String(name).trim();
  const dashIdxs = [" - "];
  for (const dash of dashIdxs) {
    const idx = clean.indexOf(dash);
    if (idx !== -1) {
      clean = clean.substring(0, idx).trim();
    }
  }

  if (/^https?:\/\//i.test(clean)) {
    try {
      const url = new URL(clean);
      return url.hostname.replace(/^www\./i, "");
    } catch {
      return clean;
    }
  }

  clean = clean.replace(/^https?:\/\/(www\.)?/i, "");
  clean = clean.replace(/^www\./i, "");
  const slashIdx = clean.indexOf("/");
  if (slashIdx !== -1) {
    clean = clean.substring(0, slashIdx);
  }
  return clean;
}

function normalizeBotName(value: string) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function getBotDisplayName(source: string, catalog: BotCatalogEntry[] = []) {
  if (!source) return "";
  let clean = cleanSourceName(source);
  const dotIdx = clean.indexOf(".");
  const baseName = dotIdx !== -1 ? clean.substring(0, dotIdx) : clean;
  const normalized = normalizeBotName(baseName);

  const friendlyNameMap: Record<string, string> = {
    webmd: "WebMD",
    instagram: "Instagram",
    "99acres": "99Acres",
    keysight: "Keysight",
    turkeybrokers: "TurkeyBrokers",
    linkedin: "LinkedIn",
    github: "GitHub",
    companieshouse: "Companies House (UK)",
    mca: "MCA (India)",
    crunchbase: "Crunchbase",
    secedgar: "SEC EDGAR",
    napdiscovery: "NAP Discovery",
  };

  if (friendlyNameMap[normalized]) {
    return friendlyNameMap[normalized];
  }

  const match = catalog.find((bot) => {
    const name = normalizeBotName(String(bot.name || ""));
    return name === normalized || normalized.includes(name) || name.includes(normalized);
  });
  if (match?.name) {
    return String(match.name);
  }

  if (/^\d+[a-z]/i.test(baseName)) {
    const numPart = baseName.match(/^\d+/)?.[0] || "";
    const textPart = baseName.slice(numPart.length);
    return numPart + textPart.charAt(0).toUpperCase() + textPart.slice(1);
  }

  return baseName.charAt(0).toUpperCase() + baseName.slice(1);
}
