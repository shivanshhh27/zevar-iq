// The plain-code maths. No AI here: matching sales to designs, finding stuck stock, ranking.

import { DesignTags, WeightBand, weightBandFor } from "./designTags";
import { SaleRow } from "./csv";

// One design = one photo the owner uploaded, plus what they typed in the form.
export type StockItem = {
  id: string; // must match design_id in the sales file
  weightGrams: number; // per piece
  quantity: number; // pieces in stock-in
  karigar: string;
  name?: string; // e.g. "Lakshmi Kasu Mala", from the stock list CSV
  ornament?: string; // e.g. "Necklace", "Kada", from the stock list CSV
  stockInDate: string; // YYYY-MM-DD
  tags: DesignTags | null; // null = AI could not tag this photo yet
};

export const STUCK_DAYS = 365;

export type DesignRow = StockItem & {
  weightBand: WeightBand;
  sold: number;
  revenue: number;
  lastSaleDate: string | null;
  ageDays: number; // days since stock-in
  idleDays: number; // days since the later of stock-in and last sale
  sellThrough: number; // sold / quantity, capped at 1
  stuck: boolean;
  lockedGrams: number; // grams still in stock for this design
};

export type BoardGroup = {
  key: string;
  designs: number;
  pieces: number;
  sold: number;
  sellThrough: number;
  avgAgeDays: number;
  stuckDesigns: number;
};

export type Analysis = {
  asOf: string;
  rows: DesignRow[];
  stuck: DesignRow[]; // do-not-reorder candidates, heaviest first
  reorder: DesignRow[]; // reorder candidates, best sellers first
  stuckGrams: number;
  unmatchedSaleIds: string[]; // sales rows whose design_id matches no photo
  byWeightBand: BoardGroup[];
  byPriceBand: BoardGroup[];
};

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS));

export function analyse(stock: StockItem[], sales: SaleRow[]): Analysis {
  // "Today" is the newest sale in the file, so old sample files still make sense.
  const asOf = sales.reduce((latest, s) => (s.date > latest ? s.date : latest), "0000-00-00");

  const known = new Set(stock.map((s) => s.id));
  const unmatchedSaleIds = [...new Set(sales.filter((s) => !known.has(s.designId)).map((s) => s.designId))];

  const rows: DesignRow[] = stock.map((item) => {
    const mine = sales.filter((s) => s.designId === item.id);
    const lastSaleDate = mine.reduce<string | null>((l, s) => (l === null || s.date > l ? s.date : l), null);
    const sold = mine.length;
    const lastActivity = lastSaleDate && lastSaleDate > item.stockInDate ? lastSaleDate : item.stockInDate;
    const idleDays = daysBetween(lastActivity, asOf);
    return {
      ...item,
      weightBand: weightBandFor(item.weightGrams),
      sold,
      revenue: mine.reduce((sum, s) => sum + s.amount, 0),
      lastSaleDate,
      ageDays: daysBetween(item.stockInDate, asOf),
      idleDays,
      sellThrough: Math.min(1, sold / item.quantity),
      stuck: idleDays >= STUCK_DAYS && sold < item.quantity,
      lockedGrams: item.weightGrams * Math.max(0, item.quantity - sold),
    };
  });

  const stuck = rows.filter((r) => r.stuck).sort((a, b) => b.lockedGrams - a.lockedGrams);

  // Reorder candidates: selling well and not stuck. Best sell-through first, then revenue.
  const reorder = rows
    .filter((r) => !r.stuck && r.sold > 0 && r.sellThrough >= 0.5)
    .sort((a, b) => b.sellThrough - a.sellThrough || b.revenue - a.revenue);

  const group = (keyOf: (r: DesignRow) => string): BoardGroup[] => {
    const map = new Map<string, DesignRow[]>();
    for (const r of rows) map.set(keyOf(r), [...(map.get(keyOf(r)) ?? []), r]);
    return [...map.entries()].map(([key, rs]) => {
      const pieces = rs.reduce((s, r) => s + r.quantity, 0);
      const sold = rs.reduce((s, r) => s + Math.min(r.sold, r.quantity), 0);
      return {
        key,
        designs: rs.length,
        pieces,
        sold,
        sellThrough: pieces ? sold / pieces : 0,
        avgAgeDays: Math.round(rs.reduce((s, r) => s + r.ageDays, 0) / rs.length),
        stuckDesigns: rs.filter((r) => r.stuck).length,
      };
    });
  };

  return {
    asOf,
    rows,
    stuck,
    reorder,
    stuckGrams: stuck.reduce((s, r) => s + r.lockedGrams, 0),
    unmatchedSaleIds,
    byWeightBand: group((r) => r.weightBand),
    byPriceBand: group((r) => r.tags?.priceBand ?? "untagged"),
  };
}
