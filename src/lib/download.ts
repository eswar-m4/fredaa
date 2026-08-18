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
