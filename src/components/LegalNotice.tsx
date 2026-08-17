import { ShieldAlert, FileText } from "lucide-react";

/**
 * General scraping legal heads-up shown wherever a user selects sources to scrape,
 * plus a per-bot / per-source terms block for the metadata panels.
 */
export function LegalNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={[
        "rounded-lg border border-warning/30 bg-warning-bg/60 text-foreground",
        compact ? "px-3 py-2.5" : "px-4 py-3",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold">Scraping terms — quick heads-up</div>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground mt-0.5">
            We only collect publicly accessible pages, honour each site's robots.txt and rate limits, and never
            touch logged-in or paywalled content or personal data. Extracted values are stored with their source
            URL and timestamp so every field can be traced back and re-verified. You remain responsible for how
            the output is used under the source site's terms of use and applicable data-protection law.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Per-bot / per-source metadata block: crawl policy + terms of use. */
export function SourceTerms({
  crawlPolicy,
  terms,
  className,
}: {
  crawlPolicy: string;
  terms: string;
  className?: string;
}) {
  return (
    <div className={["rounded-lg border border-border bg-secondary/50 p-3", className].filter(Boolean).join(" ")}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <FileText className="h-3.5 w-3.5" /> Metadata &amp; terms
      </div>
      <div className="mt-2 space-y-2 text-[12px]">
        <div>
          <div className="font-medium text-foreground">Crawl policy</div>
          <p className="text-muted-foreground leading-relaxed">{crawlPolicy}</p>
        </div>
        <div>
          <div className="font-medium text-foreground">Terms of use</div>
          <p className="text-muted-foreground leading-relaxed">{terms}</p>
        </div>
      </div>
    </div>
  );
}

/** Deterministic, readable defaults so every source carries a T&C line. */
export function defaultCrawlPolicy(name: string) {
  const n = (name || "").toLowerCase();
  if (n.includes("gov") || n.includes("registry") || n.includes("council") || n.includes("irdai")) {
    return "Public register — 1 request / 3s, business hours only, no bulk download endpoints used.";
  }
  if (n.includes("google") || n.includes("linkedin")) {
    return "Partial — only public profile/listing pages, search result paths are excluded.";
  }
  return "Allowed on public listing pages — 1 request / 2s, robots.txt re-checked before every run.";
}

export function defaultTerms(name: string) {
  return `Only publicly visible fields on ${name || "this source"} are captured. No logged-in, paywalled or personal data. Values are cached with the source URL and timestamp, re-verified on each refresh, and removal requests are honoured within 48 hours.`;
}
