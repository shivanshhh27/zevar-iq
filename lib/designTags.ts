// The fixed menu the AI must choose from when it looks at a photo.
// Keeping the list fixed means two similar rings get the same tags every time.

export const CATEGORIES = [
  "ring",
  "necklace",
  "earrings",
  "bangle",
  "bracelet",
  "pendant",
  "chain",
  "mangalsutra",
  "other",
] as const;

export const STYLES = [
  "temple",
  "antique",
  "kundan",
  "polki",
  "diamond-look",
  "minimal",
  "daily-wear",
  "bridal",
  "filigree",
  "other",
] as const;

export const PRICE_BANDS = ["under 25k", "25k-75k", "75k-2L", "above 2L"] as const;

export const WEIGHT_BANDS = ["under 5g", "5-10g", "10-20g", "above 20g"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Style = (typeof STYLES)[number];
export type PriceBand = (typeof PRICE_BANDS)[number];
export type WeightBand = (typeof WEIGHT_BANDS)[number];

// What the AI sends back for one photo.
export type DesignTags = {
  isJewellery: boolean;
  category: Category;
  style: Style;
  priceBand: PriceBand;
  confidence: number; // 0 to 1; below LOW_CONFIDENCE we ask the owner to check
};

export const LOW_CONFIDENCE = 0.6;

// Checks the AI's answer against the menu. Anything off-list returns null,
// so the screen shows "needs review" instead of trusting a bad answer.
export function parseTags(raw: unknown): DesignTags | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const confidence = Number(r.confidence);
  if (typeof r.isJewellery !== "boolean" || !Number.isFinite(confidence)) return null;
  if (!r.isJewellery) {
    return { isJewellery: false, category: "other", style: "other", priceBand: PRICE_BANDS[0], confidence: Math.min(1, Math.max(0, confidence)) };
  }
  if (!(CATEGORIES as readonly unknown[]).includes(r.category)) return null;
  if (!(STYLES as readonly unknown[]).includes(r.style)) return null;
  if (!(PRICE_BANDS as readonly unknown[]).includes(r.priceBand)) return null;
  return {
    isJewellery: true,
    category: r.category as Category,
    style: r.style as Style,
    priceBand: r.priceBand as PriceBand,
    confidence: Math.min(1, Math.max(0, confidence)),
  };
}

// Weight comes from the owner's form, so plain code (not AI) decides the band.
export function weightBandFor(grams: number): WeightBand {
  if (grams < 5) return "under 5g";
  if (grams < 10) return "5-10g";
  if (grams < 20) return "10-20g";
  return "above 20g";
}
