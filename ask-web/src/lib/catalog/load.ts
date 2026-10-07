import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import type {
  AgentRecord,
  Catalog,
  FacetCount,
  OverviewStat,
  SheetInfo,
  SolutionRecord,
  SolutionSourceRecord,
} from "./types";

let cached: Catalog | null = null;

function cell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value).trim();
}

function splitList(value: string): string[] {
  return value
    .split(/[;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hostnameOf(url: string): string {
  const raw = url.trim();
  if (!raw || raw.startsWith("{") || raw.startsWith("(")) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function sheetRows(workbook: XLSX.WorkBook, name: string): Record<string, string>[] {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => cell(h));
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = cell(row[index]);
    });
    return record;
  });
}

function facetSheet(workbook: XLSX.WorkBook, name: string): FacetCount[] {
  const rows = sheetRows(workbook, name);
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0]);
  const nameKey = keys[0];
  const countKey = keys[1];
  return rows
    .map((row) => ({
      name: row[nameKey] ?? "",
      count: Number(row[countKey] || 0),
    }))
    .filter((row) => row.name);
}

function parseCatalog(): Catalog {
  const filePath = path.join(
    process.cwd(),
    "data",
    "Freda_Agents_and_Solutions_Catalog.xlsx",
  );
  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const overviewRows = XLSX.utils.sheet_to_json<(string | number | null)[]>(
    workbook.Sheets["Overview"],
    { header: 1, defval: "", raw: true },
  );

  const overview: OverviewStat[] = [];
  const sheets: SheetInfo[] = [];
  let generated = "";
  let inSheetLegend = false;

  for (const row of overviewRows) {
    const label = cell(row[0]);
    const value = cell(row[1]);
    if (!label) continue;
    if (label === "Generated") {
      generated = value;
      continue;
    }
    if (label === "Sheet" && value === "Contents") {
      inSheetLegend = true;
      continue;
    }
    if (inSheetLegend) {
      sheets.push({ name: label, contents: value });
    } else if (value) {
      overview.push({ label, value });
    }
  }

  const agents: AgentRecord[] = sheetRows(workbook, "Agents Catalog")
    .filter((row) => row["Agent ID"] && row["Agent / Solution Name"])
    .map((row) => {
      const sourceUrl = row["Source Link"] ?? "";
      return {
        id: row["Agent ID"],
        name: row["Agent / Solution Name"],
        sourceUrl,
        project: row["Project"] ?? "",
        type: row["Type"] ?? "",
        category: row["Category"] ?? "",
        industry: row["Industry"] ?? "",
        country: row["Country"] ?? "",
        dataType: row["Data Type Available"] ?? "",
        description: row["Description / Info"] ?? "",
        complexity: row["Complexity"] ?? "",
        datapoints: row["Datapoints"] ?? "",
        estimatedRecords: row["Estimated Records"] ?? "",
        runtimeType: row["Runtime Type"] ?? "",
        hostname: hostnameOf(sourceUrl),
      };
    });

  const solutions: SolutionRecord[] = sheetRows(workbook, "Solutions Catalog")
    .filter((row) => row["Solution ID"])
    .map((row) => ({
      id: row["Solution ID"],
      name: row["Solution Name"] ?? "",
      category: row["Category"] ?? "",
      tagline: row["Tagline"] ?? "",
      description: row["Description"] ?? "",
      records: row["Rows / Records Available"] ?? "",
      coverage: row["Coverage %"] ?? "",
      accuracy: row["Accuracy %"] ?? "",
      countriesCovered: row["Countries Covered"] ?? "",
      refreshCadence: row["Default Refresh Cadence"] ?? "",
      refreshOptions: splitList(row["Refresh Options"] ?? ""),
      sourceCount: row["# Sources"] ?? "",
      sourceNames: splitList(row["Source Names"] ?? ""),
      attributeCount: row["# Output Attributes"] ?? "",
      attributes: splitList(row["Output Attributes (Names)"] ?? ""),
      inputAttributeCount: row["# Input Attributes"] ?? "",
    }));

  const sources: SolutionSourceRecord[] = sheetRows(workbook, "Solution Sources")
    .filter((row) => row["Solution ID"] && row["Source Name"])
    .map((row) => ({
      solutionId: row["Solution ID"],
      solutionName: row["Solution Name"] ?? "",
      solutionCategory: row["Solution Category"] ?? "",
      name: row["Source Name"],
      url: row["Source URL"] ?? "",
      kind: row["Source Kind"] ?? "",
      attributesContributed: row["Attributes Contributed"] ?? "",
      region: row["Region"] ?? "",
    }));

  return {
    generated,
    overview,
    sheets,
    agents,
    solutions,
    sources,
    agentsByCategory: facetSheet(workbook, "Agents By Category"),
    agentsByIndustry: facetSheet(workbook, "Agents By Industry"),
    agentsByDataType: facetSheet(workbook, "Agents By Data Type"),
    solutionsByCategory: facetSheet(workbook, "Solutions By Category"),
  };
}

export function loadCatalog(): Catalog {
  if (!cached) cached = parseCatalog();
  return cached;
}

export function getAgentById(id: string): AgentRecord | undefined {
  return loadCatalog().agents.find((agent) => agent.id === id);
}

export function getSolutionById(id: string): SolutionRecord | undefined {
  return loadCatalog().solutions.find((solution) => solution.id === id);
}

export function sourcesForSolution(id: string): SolutionSourceRecord[] {
  return loadCatalog().sources.filter((source) => source.solutionId === id);
}
