// Reads the owner's sales file and checks it is usable.
// Required columns: design_id, date, amount (extra columns are ignored).

export type SaleRow = { designId: string; date: string; amount: number }; // date is YYYY-MM-DD

export type CsvResult =
  | { ok: true; sales: SaleRow[] }
  | { ok: false; error: string };

const REQUIRED = ["design_id", "date", "amount"];

// Splits one CSV line, respecting "quoted, values".
function splitLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

// Accepts 2026-03-14 or 14/03/2026 (the Indian day-first style). Returns YYYY-MM-DD or null.
function parseDate(raw: string): string | null {
  let y: number, m: number, d: number;
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [d, m, y] = [+match[1], +match[2], +match[3]];
  else return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return check.toISOString().slice(0, 10);
}

export function parseSalesCsv(text: string): CsvResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { ok: false, error: "The sales file is empty." };

  const header = splitLine(lines[0]).map((h) => h.toLowerCase());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `The sales file is missing these columns: ${missing.join(", ")}. It needs design_id, date and amount.`,
    };
  }
  if (lines.length === 1) return { ok: false, error: "The sales file has headings but no sales rows." };

  const col = (name: string) => header.indexOf(name);
  const sales: SaleRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const date = parseDate(cells[col("date")] ?? "");
    const amount = Number((cells[col("amount")] ?? "").replace(/[₹,\s]/g, ""));
    const designId = cells[col("design_id")] ?? "";
    if (!designId || !date || !Number.isFinite(amount) || amount <= 0) {
      return {
        ok: false,
        error: `Row ${i + 1} of the sales file has a problem (design_id, date or amount is missing or not valid). Please fix it and upload again.`,
      };
    }
    sales.push({ designId, date, amount });
  }
  return { ok: true, sales };
}
