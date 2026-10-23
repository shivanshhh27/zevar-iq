// The plain-code maths for a bill. No AI here.
// Simplified for the prototype: one GST rate (3%) on gold plus making charge.

export const GST_PERCENT = 3;

export type Bill = {
  designId: string;
  date: string; // YYYY-MM-DD
  grams: number;
  rate: number; // rupees per gram
  makingPercent: number;
  gold: number;
  making: number;
  gst: number;
  total: number;
};

const rupees = (n: number) => Math.round(n);

export function makeBill(input: { designId: string; date: string; grams: number; rate: number; makingPercent: number }): Bill {
  const gold = rupees(input.grams * input.rate);
  const making = rupees((gold * input.makingPercent) / 100);
  const gst = rupees(((gold + making) * GST_PERCENT) / 100);
  return { ...input, gold, making, gst, total: gold + making + gst };
}

// Returns a plain message if the bill is not usable, otherwise null.
export function billProblem(input: { designId: string; date: string; grams: number; rate: number; makingPercent: number }): string | null {
  if (!input.designId) return "Pick a design.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(input.date))) return "Enter the bill date.";
  if (!(input.grams > 0)) return "Enter the weight in grams.";
  if (!(input.rate > 0)) return "Enter the gold rate per gram.";
  if (!(input.makingPercent >= 0)) return "Making charge cannot be negative.";
  return null;
}

// A saved bill becomes one sale row, the same shape the sales file produces.
export const billToSale = (b: Bill) => ({ designId: b.designId, date: b.date, amount: b.total });
