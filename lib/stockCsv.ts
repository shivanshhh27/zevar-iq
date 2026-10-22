// Reads the owner's stock list (purchases): one row per design.
// Required columns: design_id, weight_grams, quantity, stock_in_date.
// Optional columns: design_name, ornament_type, purity, karigar. Extra columns are ignored.

import { splitLine, parseDate } from "./csv";
import { Category } from "./designTags";

export type StockRow = {
  id: string;
  name: string;
  ornament: string;
  purity: string;
  karigar: string;
  weightGrams: number; // per piece
  quantity: number;
  stockInDate: string; // YYYY-MM-DD
};

export type StockCsvResult = { ok: true; rows: StockRow[] } | { ok: false; error: string };

const REQUIRED = ["design_id", "weight_grams", "quantity", "stock_in_date"];

// Turns an ornament type written the Indian way (Haar, Kada, Jhumka...) into one of our fixed categories.
export function categoryForOrnament(text: string): Category | undefined {
  const t = text.toLowerCase();
  if (/ear|jhumk|chandbali|stud|bali/.test(t)) return "earrings";
  if (/bangle|kada|kangan|churi|chudi/.test(t)) return "bangle";
  if (/bracelet/.test(t)) return "bracelet";
  if (/pendant|locket/.test(t)) return "pendant";
  if (/mangalsutra|thali/.test(t)) return "mangalsutra";
  if (/chain/.test(t)) return "chain";
  if (/necklace|haar|mala|choker|kanthi|rani/.test(t)) return "necklace";
  if (/ring/.test(t)) return "ring";
  return undefined;
}

export function parseStockCsv(text: string): StockCsvResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { ok: false, error: "The stock list is empty." };

  const header = splitLine(lines[0]).map((h) => h.toLowerCase());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `The stock list is missing these columns: ${missing.join(", ")}. It needs design_id, weight_grams, quantity and stock_in_date.`,
    };
  }
  if (lines.length === 1) return { ok: false, error: "The stock list has headings but no rows." };

  const col = (name: string) => header.indexOf(name);
  const cell = (cells: string[], name: string) => (col(name) === -1 ? "" : (cells[col(name)] ?? ""));
  const rows: StockRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const id = cell(cells, "design_id");
    const weightGrams = Number(cell(cells, "weight_grams"));
    const quantity = Number(cell(cells, "quantity"));
    const stockInDate = parseDate(cell(cells, "stock_in_date"));
    if (!id || !(weightGrams > 0) || !Number.isInteger(quantity) || quantity < 1 || !stockInDate) {
      return {
        ok: false,
        error: `Row ${i + 1} of the stock list has a problem (design_id, weight_grams, quantity or stock_in_date is missing or not valid). Please fix it and upload again.`,
      };
    }
    if (seen.has(id.toLowerCase())) return { ok: false, error: `design_id ${id} appears twice in the stock list (row ${i + 1}). Each design needs one row.` };
    seen.add(id.toLowerCase());
    rows.push({
      id,
      name: cell(cells, "design_name"),
      ornament: cell(cells, "ornament_type"),
      purity: cell(cells, "purity"),
      karigar: cell(cells, "karigar"),
      weightGrams,
      quantity,
      stockInDate,
    });
  }
  return { ok: true, rows };
}
