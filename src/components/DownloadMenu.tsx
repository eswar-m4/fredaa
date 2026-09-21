import { Download, FileSpreadsheet, FileText } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui-bits";
import { downloadCsv, downloadXlsxMultiSheet, type XlsxSheetSpec } from "@/lib/download";
import { recordsForDownload, buildRefreshedMonitoringRows } from "@/lib/monitoring-live-review";
import { getLiveRefreshProfile } from "@/lib/live-refresh-profiles";
import { isCustomProjectId } from "@/lib/custom-projects";
import type { Project, ChangeType } from "@/data/customers";

// live-check records carry the raw field key as `datapoint`/each wide
// column's raw key (see ReviewDialog.tsx's columnLabel comment) — map back
// to the pretty label from project.datapoints, but only for self-provisioned
// projects (raw slugified keys like organization_name); onboarded real
// projects (NTM/ERIS/ABM/...) already carry their real source template's
// own column names, so those are left exactly as-is.
function labelForColumn(project: Project, col: string): string {
  if (!isCustomProjectId(project.id)) return col;
  const offset = project.columns.length - project.datapoints.length;
  if (offset < 0) return col;
  const idx = project.columns.indexOf(col);
  if (idx < offset) return col;
  return project.datapoints[idx - offset] ?? col;
}

function rollupStatus(types: ChangeType[]): ChangeType {
  if (types.includes("Added")) return "Added";
  if (types.includes("Deleted")) return "Deleted";
  if (types.includes("Modified")) return "Modified";
  return "Verified";
}

/** One row per entity, every real tracked field as its own column (exactly
 *  like the source table), plus the review-tracking columns (status,
 *  confidence, source) rolled up per entity — combining what used to be two
 *  separate tabs (a wide "Output" table and a long per-field "Review" list)
 *  into the single sheet customers actually want to open. Falls back to the
 *  long per-field list alone only for the rare project with no real wide
 *  row/column shape at all (no sampleRows/columns). */
function combinedRows(project: Project): Array<Record<string, string | number>> {
  const records = recordsForDownload(project);
  const refreshed = buildRefreshedMonitoringRows(project);

  if (!refreshed) {
    return records.map((r) => ({
      entity: r.entity,
      datapoint: labelForColumn(project, r.datapoint),
      change_type: r.changeType,
      old_value: r.oldValue,
      new_value: r.newValue,
      confidence: r.confidence,
      source: r.source,
      source_url: r.sourceUrl,
    }));
  }

  const nameField = getLiveRefreshProfile(project.id)?.nameField ?? refreshed.columns[0] ?? "";
  const byEntity = new Map<string, { types: ChangeType[]; confidences: number[]; source: string; sourceUrl: string }>();
  for (const r of records) {
    const g = byEntity.get(r.entity) ?? { types: [], confidences: [], source: r.source, sourceUrl: r.sourceUrl };
    g.types.push(r.changeType);
    g.confidences.push(r.confidence);
    byEntity.set(r.entity, g);
  }

  return refreshed.rows.map((row) => {
    const entity = String(row[nameField] ?? "");
    const g = byEntity.get(entity);
    const out: Record<string, string | number> = {};
    for (const c of refreshed.columns) out[labelForColumn(project, c)] = row[c] ?? "";
    out["Review Status"] = g ? rollupStatus(g.types) : "Verified";
    out["Confidence"] = g && g.confidences.length ? Math.round(g.confidences.reduce((a, b) => a + b, 0) / g.confidences.length) : "";
    out["Source"] = g?.source ?? "";
    out["Source URL"] = g?.sourceUrl ?? "";
    return out;
  });
}

/** Small download icon button next to a project's Review action — exports
 *  the real captured data (the last live "Run" result if one exists,
 *  otherwise the real on-file baseline) as one combined table: every
 *  tracked field as its own column, one row per entity, plus rolled-up
 *  review status/confidence/source columns — as CSV or a single-sheet
 *  Excel file. */
export function DownloadMenu({ project }: { project: Project }) {
  const baseName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  function downloadExcel() {
    const sheets: XlsxSheetSpec[] = [{ name: "Output", rows: combinedRows(project) }];
    void downloadXlsxMultiSheet(`${baseName}-review.xlsx`, sheets);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="w-9 px-0 justify-center shrink-0"
          title="Download this project's review data"
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => downloadCsv(`${baseName}-review.csv`, combinedRows(project))}>
          <FileText className="h-3.5 w-3.5" /> Download as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={downloadExcel}>
          <FileSpreadsheet className="h-3.5 w-3.5" /> Download as Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
