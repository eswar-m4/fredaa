// Real SEC EDGAR registry lookup — ports the actual scraper the FreDA
// "firmographic" pipeline uses (backend/app/services/registry_scrapers/
// sec_scraper.py in the main fredaa app) rather than relying only on the
// generic AI-webpage-read engine for fields that genuinely live in a real
// government registry, not on a company's marketing site (legal name, SIC
// code, registration number/CIK, incorporation address) — confirmed via
// direct testing: neither endpoint below needs auth, and SEC explicitly
// documents them as public.
const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS_URL = (cik: string) => `https://data.sec.gov/submissions/CIK${cik}.json`;
// SEC's own developer docs ask for a real contact-identifying User-Agent —
// generic/browser UAs get blocked.
const SEC_USER_AGENT = "FREDA Registry Intelligence contact@example.com";

export type SecEdgarProfile = {
  legal_name: string;
  sic_code: string;
  industry: string;
  registry_number: string;
  hq_address: string;
  hq_city: string;
  hq_state: string;
  hq_country: string;
  phone: string;
  company_type: string;
};

type TickerEntry = { cik_str: number; ticker: string; title: string };

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC", "PR", "VI", "GU", "AS", "MP",
]);

let tickerCache: Record<string, TickerEntry> | null = null;
let tickerCacheAt = 0;
const TICKER_CACHE_TTL_MS = 60 * 60 * 1000; // SEC's own file only refreshes a few times a day

async function fetchJson(url: string, timeoutMs = 18000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json,text/plain,*/*" },
    });
    if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getTickers(): Promise<Record<string, TickerEntry>> {
  const now = Date.now();
  if (tickerCache && now - tickerCacheAt < TICKER_CACHE_TTL_MS) return tickerCache;
  tickerCache = (await fetchJson(SEC_TICKERS_URL)) as Record<string, TickerEntry>;
  tickerCacheAt = now;
  return tickerCache;
}

function normalizeCik(value: number | string): string {
  return String(value).replace(/\D+/g, "").padStart(10, "0");
}

/** Fuzzy company-name match against SEC's real ~10k-issuer ticker list —
 *  exact match scores highest, then substring, then token-overlap (Jaccard)
 *  — mirrors the Python scraper's matching so results stay consistent with
 *  the real FreDA pipeline's behavior, not a different heuristic. */
function resolveCik(companyName: string, tickers: Record<string, TickerEntry>): { cik: string; title: string; score: number } | null {
  const normalized = companyName.trim().toLowerCase();
  if (!normalized) return null;
  let best: TickerEntry | null = null;
  let bestScore = 0;
  for (const item of Object.values(tickers)) {
    const title = (item.title || "").trim().toLowerCase();
    if (!title) continue;
    let score = 0;
    if (normalized === title) score = 100;
    else if (normalized.includes(title) || title.includes(normalized)) score = 85;
    else {
      const a = new Set(normalized.match(/[a-z0-9]+/g) ?? []);
      const b = new Set(title.match(/[a-z0-9]+/g) ?? []);
      if (a.size && b.size) {
        const intersect = [...a].filter((x) => b.has(x)).length;
        const union = new Set([...a, ...b]).size;
        score = Math.round((100 * intersect) / union);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  if (best && bestScore >= 55) return { cik: normalizeCik(best.cik_str), title: best.title, score: bestScore };
  return null;
}

/** Looks up a company by name in SEC EDGAR and returns its real registry
 *  profile, or null if there's no confident match (a private company, a
 *  non-US filer, or just not found) — callers should treat null as "SEC
 *  doesn't have this one", not an error, and keep whatever the AI-webpage
 *  check already found. */
export async function fetchSecEdgarProfile(companyName: string): Promise<SecEdgarProfile | null> {
  const name = companyName.trim();
  if (!name) return null;
  try {
    const tickers = await getTickers();
    const match = resolveCik(name, tickers);
    if (!match) return null;
    const submission = await fetchJson(SEC_SUBMISSIONS_URL(match.cik));
    const business = submission?.addresses?.business ?? {};
    const mailing = submission?.addresses?.mailing ?? {};
    // SEC's stateOrCountryDescription is NOT reliably a country — for a
    // domestic filer it just repeats the 2-letter state code (confirmed:
    // Apple's is "CA", not "United States"), and its own isForeignLocation
    // flag turned out unreliable too (confirmed: NICE Ltd's is 0/null on
    // both addresses despite genuinely being an Israeli company). The one
    // consistently reliable signal: whether stateOrCountry matches a real
    // US state code at all — if it doesn't, whatever description SEC
    // supplies is the best available real signal for the country; if
    // there's no description either, this honestly leaves it blank rather
    // than guessing.
    const isUsState = US_STATE_CODES.has(String(business.stateOrCountry ?? "").toUpperCase());
    const countryDescription = isUsState ? "" : String(business.stateOrCountryDescription || mailing.stateOrCountryDescription || "").trim();
    return {
      legal_name: String(submission?.name ?? match.title ?? "").trim(),
      sic_code: String(submission?.sic ?? "").trim(),
      industry: String(submission?.sicDescription ?? "").trim(),
      registry_number: match.cik,
      hq_address: String(business.street1 ?? "").trim(),
      hq_city: String(business.city ?? "").trim(),
      hq_state: String(business.stateOrCountry ?? "").trim(),
      hq_country: String(countryDescription || (isUsState ? "USA" : "")).trim(),
      phone: String(submission?.phone ?? "").trim(),
      company_type: "Public",
    };
  } catch {
    // Rate-limited, transient network failure, or SEC's own service being
    // down — honestly return "no data", never a guessed profile.
    return null;
  }
}
