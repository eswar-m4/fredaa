export function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (typeof window === "undefined") return;
  const headers = rows.length ? Object.keys(rows[0]!) : ["info"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.length
    ? rows.map((r) => headers.map((h) => escape(r[h])).join(",")).join("\n")
    : escape("No records");
  const csv = `${headers.join(",")}\n${body}`;
  downloadBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8;" }));
}

export type XlsxSheetSpec = {
  name: string;
  rows: Array<Record<string, string | number>>;
  /** Explicit column order; defaults to the first row's key order. */
  headers?: string[];
};

export async function downloadXlsxMultiSheet(filename: string, sheets: XlsxSheetSpec[]) {
  if (typeof window === "undefined") return;
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  for (const { name, rows, headers: explicitHeaders } of sheets) {
    const sheet = workbook.addWorksheet(name.slice(0, 31)); // Excel sheet-name limit
    const headers = explicitHeaders ?? (rows.length ? Object.keys(rows[0]!) : ["info"]);
    sheet.addRow(headers).font = { bold: true };
    for (const row of rows.length ? rows : [{ info: "No records" }]) {
      sheet.addRow(headers.map((h) => row[h] ?? ""));
    }
    sheet.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        max = Math.max(max, String(cell.value ?? "").length + 2);
      });
      col.width = Math.min(60, max);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(filename, new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

export async function downloadXlsx(filename: string, sheetName: string, rows: Array<Record<string, string | number>>) {
  await downloadXlsxMultiSheet(filename, [{ name: sheetName, rows }]);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
