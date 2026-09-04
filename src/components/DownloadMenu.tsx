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
import type { Project } from "@/data/customers";

function toReviewRows(project: Project) {
  return recordsForDownload(project).map((r) => ({
    entity: r.entity,
    datapoint: r.datapoint,
    change_type: r.changeType,
    old_value: r.oldValue,
    new_value: r.newValue,
    confidence: r.confidence,
    source: r.source,
    source_url: r.sourceUrl,
  }));
}

/** Small download icon button next to a project's Review action — exports
 *  whatever data the Review popup currently shows for that project (the
 *  last live "Run" result if one exists, otherwise the sample data), as
 *  CSV or Excel. The Excel version also adds a second tab reconstructing
 *  the full record in the project's original Output template layout, for
 *  projects onboarded with a live-refresh profile. */
export function DownloadMenu({ project }: { project: Project }) {
  const baseName = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  function downloadExcel() {
    const sheets: XlsxSheetSpec[] = [{ name: "Review", rows: toReviewRows(project) }];
    const refreshed = buildRefreshedMonitoringRows(project);
    if (refreshed) {
      sheets.push({
        name: refreshed.sheetName,
        headers: refreshed.columns,
        rows: refreshed.rows,
      });
    }
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
        <DropdownMenuItem onClick={() => downloadCsv(`${baseName}-review.csv`, toReviewRows(project))}>
          <FileText className="h-3.5 w-3.5" /> Download as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={downloadExcel}>
          <FileSpreadsheet className="h-3.5 w-3.5" /> Download as Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
