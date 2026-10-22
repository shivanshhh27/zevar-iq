// Checks the plain-code maths (no AI, no network). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseSalesCsv } from "../lib/csv";
import { analyse, StockItem } from "../lib/analysis";
import { parseTags } from "../lib/designTags";
import { categoryForOrnament, parseStockCsv } from "../lib/stockCsv";

const tags = { isJewellery: true, category: "ring", style: "minimal", priceBand: "25k-75k", confidence: 0.9 } as const;
const item = (id: string, grams: number, qty: number, stockIn: string): StockItem => ({
  id,
  weightGrams: grams,
  quantity: qty,
  karigar: "",
  stockInDate: stockIn,
  tags,
});

test("sales CSV: accepts day-first dates, rupee amounts with commas and extra columns", () => {
  const r = parseSalesCsv('design_id,date,amount,salesperson\nD08,15/04/2026,"₹1,18,000",Anil\n');
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.sales, [{ designId: "D08", date: "2026-04-15", amount: 118000 }]);
});

test("sales CSV: bad input gives a plain message instead of crashing", () => {
  const cases: [string, RegExp][] = [
    ["", /empty/],
    ["design_id,date\nD1,2026-01-01", /missing these columns: amount/],
    ["design_id,date,amount\n", /no sales rows/],
    ["design_id,date,amount\nD1,31/02/2026,500", /Row 2/],
    ["design_id,date,amount\nD1,2026-01-01,-5", /Row 2/],
  ];
  for (const [text, message] of cases) {
    const r = parseSalesCsv(text);
    assert.ok(!r.ok);
    if (!r.ok) assert.match(r.error, message);
  }
});

test("stock list CSV: reads names, ornament types, grams, quantity and dates", () => {
  const r = parseStockCsv("design_id,design_name,ornament_type,purity,weight_grams,quantity,stock_in_date,karigar\nD01,Lakshmi Kasu Mala,Necklace,22K,38.5,1,10/02/2025,Murugan - Coimbatore\n");
  assert.ok(r.ok);
  if (r.ok)
    assert.deepEqual(r.rows, [
      { id: "D01", name: "Lakshmi Kasu Mala", ornament: "Necklace", purity: "22K", karigar: "Murugan - Coimbatore", weightGrams: 38.5, quantity: 1, stockInDate: "2025-02-10" },
    ]);
});

test("stock list CSV: bad input gives a plain message instead of crashing", () => {
  const cases: [string, RegExp][] = [
    ["", /empty/],
    ["design_id,weight_grams,quantity\nD1,5,1", /missing these columns: stock_in_date/],
    ["design_id,weight_grams,quantity,stock_in_date\n", /no rows/],
    ["design_id,weight_grams,quantity,stock_in_date\nD1,-5,1,2026-01-01", /Row 2/],
    ["design_id,weight_grams,quantity,stock_in_date\nD1,5,1.5,2026-01-01", /Row 2/],
    ["design_id,weight_grams,quantity,stock_in_date\nD1,5,1,2026-01-01\nd1,6,1,2026-01-01", /appears twice/],
  ];
  for (const [text, message] of cases) {
    const r = parseStockCsv(text);
    assert.ok(!r.ok);
    if (!r.ok) assert.match(r.error, message);
  }
});

test("ornament types written the Indian way map to our categories", () => {
  const expected: [string, string | undefined][] = [
    ["Necklace", "necklace"],
    ["Haar", "necklace"],
    ["Choker", "necklace"],
    ["Kada", "bangle"],
    ["Churi", "bangle"],
    ["Bangle", "bangle"],
    ["Jhumka", "earrings"],
    ["Earrings", "earrings"],
    ["Ring", "ring"],
    ["Pendant", "pendant"],
    ["Mangalsutra", "mangalsutra"],
    ["Bracelet", "bracelet"],
    ["Spaceship", undefined],
  ];
  for (const [text, category] of expected) assert.equal(categoryForOrnament(text), category, text);
});

test("demo data: 6 designs hold 243 g and are stuck", () => {
  const dir = new URL("../public/sample/", import.meta.url);
  const csv = parseSalesCsv(fs.readFileSync(new URL("sales.csv", dir), "utf8"));
  const stockList = parseStockCsv(fs.readFileSync(new URL("designs.csv", dir), "utf8"));
  assert.ok(csv.ok && stockList.ok);
  if (!csv.ok || !stockList.ok) return;
  assert.equal(stockList.rows.length, 20);
  const stock: StockItem[] = stockList.rows.map((r) => ({
    id: r.id,
    weightGrams: r.weightGrams,
    quantity: r.quantity,
    karigar: r.karigar,
    name: r.name,
    ornament: r.ornament,
    stockInDate: r.stockInDate,
    tags,
  }));
  const result = analyse(stock, csv.sales);
  assert.deepEqual(result.stuck.map((s) => s.id).sort(), ["D01", "D02", "D03", "D04", "D05", "D06"]);
  assert.equal(Math.round(result.stuckGrams * 10) / 10, 243);
  assert.deepEqual(result.unmatchedSaleIds, []);
});

test("stuck rule: idle 365 days or more with stock left is stuck; 364 is not; a recent sale resets it", () => {
  const sales = [{ designId: "NEW", date: "2026-06-30", amount: 1 }]; // "today" is the newest sale
  const result = analyse(
    [
      item("EDGE", 10, 1, "2025-06-30"), // exactly 365 days
      item("JUST", 10, 1, "2025-07-01"), // 364 days
      item("SOLD_OUT", 10, 1, "2025-01-01"), // old, but fully sold
      item("RESET", 10, 2, "2025-01-01"), // old, one sold recently
      item("NEW", 10, 1, "2026-06-30"),
    ],
    [
      ...sales,
      { designId: "SOLD_OUT", date: "2025-01-05", amount: 1 },
      { designId: "RESET", date: "2026-05-01", amount: 1 },
    ],
  );
  const stuck = (id: string) => result.rows.find((r) => r.id === id)!.stuck;
  assert.equal(stuck("EDGE"), true);
  assert.equal(stuck("JUST"), false);
  assert.equal(stuck("SOLD_OUT"), false);
  assert.equal(stuck("RESET"), false);
});

test("nothing stuck gives zero grams, and unknown sales IDs are reported", () => {
  const result = analyse([item("A", 5, 1, "2026-06-01")], [
    { designId: "A", date: "2026-06-20", amount: 10 },
    { designId: "GHOST", date: "2026-06-21", amount: 10 },
  ]);
  assert.equal(result.stuck.length, 0);
  assert.equal(result.stuckGrams, 0);
  assert.deepEqual(result.unmatchedSaleIds, ["GHOST"]);
});

test("AI answers: off-list values are rejected, valid ones kept", () => {
  assert.equal(parseTags({ isJewellery: true, category: "ring", style: "minimal", priceBand: "above_100k", confidence: 0.9 }), null);
  assert.equal(parseTags({ isJewellery: true, category: "spaceship", style: "minimal", priceBand: "25k-75k", confidence: 0.9 }), null);
  assert.equal(parseTags("nonsense"), null);
  assert.ok(parseTags({ isJewellery: true, category: "ring", style: "minimal", priceBand: "25k-75k", confidence: 0.9 }));
  assert.equal(parseTags({ isJewellery: false, confidence: 2 })?.confidence, 1); // confidence is clamped to 0..1
});
