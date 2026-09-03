export function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (typeof window === "undefined") return;
  const headers = rows.length ? Object.keys(rows[0]!) : ["info"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.length
    ? rows.map((r) => headers.map((h) => escape(r[h])).join(",")).join("\n")
    : escape("No records");
  const csv = `${headers.join(",")}\n${body}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadXlsx(filename: string, rows: Array<Record<string, string | number>>) {
  if (typeof window === "undefined") return;
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");

  if (rows.length > 0) {
    const headers = Object.keys(rows[0]!);
    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true };
    rows.forEach((row) => sheet.addRow(headers.map((h) => row[h] ?? "")));
    sheet.columns.forEach((col) => {
      col.width = Math.max(12, String(col.header ?? "").length + 4);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
