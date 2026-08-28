import ExcelJS from "exceljs";
import { readdir, writeFile } from "fs/promises";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(__dirname, "src", "data", "xlsx-data.json");

const files = (await readdir(ROOT)).filter(f => f.endsWith(".xlsx"));
console.log("Found xlsx files:", files);

const result = {};

for (const file of files) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(ROOT, file));
  const fileKey = basename(file, ".xlsx");
  result[fileKey] = {};

  wb.eachSheet((sheet) => {
    const rows = [];
    let headers = [];
    sheet.eachRow((row, rowNum) => {
      const values = row.values.slice(1);
      if (rowNum === 1) {
        headers = values.map(v => String(v ?? "").trim());
      } else {
        const obj = {};
        headers.forEach((h, i) => {
          let val = values[i];
          if (val instanceof Date) val = val.toISOString().split("T")[0];
          else if (typeof val === "object" && val !== null && val.text) val = val.text;
          else if (val === null || val === undefined) val = "";
          else val = String(val).trim();
          obj[h] = val;
        });
        if (Object.values(obj).some(v => v !== "")) rows.push(obj);
      }
    });
    result[fileKey][sheet.name] = { headers, rows };
  });
}

// Build compact version: metadata + first 10 sample rows per sheet
const compact = {};
for (const [fileKey, sheets] of Object.entries(result)) {
  compact[fileKey] = {};
  for (const [sheetName, data] of Object.entries(sheets)) {
    compact[fileKey][sheetName] = {
      totalRows: data.rows.length,
      headers: data.headers,
      sampleRows: data.rows.slice(0, 10),
    };
  }
}

await writeFile(OUT, JSON.stringify(compact, null, 2));
console.log("\nDone. Written to:", OUT);
for (const [file, sheets] of Object.entries(compact)) {
  for (const [sheet, data] of Object.entries(sheets)) {
    console.log(`  [${file}] "${sheet}": ${data.totalRows} rows | cols: ${data.headers.slice(0, 8).join(" | ")}`);
  }
}
