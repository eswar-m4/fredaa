// "FreDA AI" intake reader — parses an uploaded source list / spec file and
// derives the source URLs, datapoints and an entity-count estimate from it.

export type IntakeResult = {
  fileName: string;
  urls: string[];
  datapoints: string[];
  entityRows: number;
  suggestedName: string;
  confidence: number;
  notes: string[];
};

const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s",;]*)?)/gi;

const KNOWN_DATAPOINTS = [
  "Company name", "Legal name", "Website", "Domain", "HQ city", "HQ country", "Address",
  "Employee count", "Revenue band", "Industry", "Founded year", "Phone", "Contact email",
  "LinkedIn", "CEO name", "Decision maker", "Price", "SKU", "Brand", "Availability",
  "Rating", "Review count", "Category", "Last verified",
];

function titleCase(v: string) {
  const clean = v.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

function looksLikeUrl(v: string) {
  return /^(https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}/i.test(v.trim());
}

/** Parse a CSV / TSV / TXT spec file into sources + datapoints. */
export function readIntakeFile(fileName: string, text: string): IntakeResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const notes: string[] = [];

  // 1. sources — every unique URL/host found anywhere in the file
  const urls = [
    ...new Set(
      (text.match(URL_RE) ?? [])
        .map((u) => u.replace(/[),;]+$/, "").trim())
        .filter((u) => !/\.(csv|xlsx|pdf|png|jpg)$/i.test(u))
        .map((u) => (u.startsWith("http") ? u : `https://${u}`)),
    ),
  ].slice(0, 25);

  // 2. datapoints — header row columns that are not URLs
  const delim = (lines[0] ?? "").includes("\t") ? "\t" : (lines[0] ?? "").includes(",") ? "," : "";
  let datapoints: string[] = [];
  let entityRows = Math.max(0, lines.length - 1);

  if (delim) {
    const header = lines[0]!.split(delim).map((c) => c.replace(/^"|"$/g, "").trim());
    datapoints = header.filter((c) => c && !looksLikeUrl(c)).map(titleCase).filter(Boolean);
    notes.push(`Detected a ${delim === "," ? "CSV" : "TSV"} table with ${header.length} columns.`);
  } else {
    // plain list — treat non-URL lines as datapoint names
    datapoints = lines.filter((l) => !looksLikeUrl(l) && l.length < 48).map(titleCase).slice(0, 24);
    entityRows = urls.length;
    notes.push("Detected a plain list — read line by line.");
  }

  if (datapoints.length === 0) {
    datapoints = KNOWN_DATAPOINTS.slice(0, 8);
    notes.push("No datapoint columns found — applied the standard starter schema.");
  }

  const matched = datapoints.filter((d) => KNOWN_DATAPOINTS.some((k) => k.toLowerCase() === d.toLowerCase()));
  if (matched.length) notes.push(`${matched.length} datapoints matched FreDA's verified attribute library.`);
  if (urls.length) notes.push(`${urls.length} source ${urls.length === 1 ? "URL" : "URLs"} extracted and de-duplicated.`);
  else notes.push("No source URLs found in the file — add at least one manually.");

  const base = fileName.replace(/\.[a-z0-9]+$/i, "");
  const confidence = Math.min(97, 68 + matched.length * 3 + Math.min(12, urls.length * 2));

  return {
    fileName,
    urls,
    datapoints: [...new Set(datapoints)].slice(0, 24),
    entityRows,
    suggestedName: titleCase(base) || "Imported project",
    confidence,
    notes,
  };
}
