// Runs on the server so the API key never reaches the browser.
// Receives up to 5 photos at once, asks Gemini to tag them in ONE request, checks each answer, sends them back.
// Batching keeps us well inside the free plan's daily request limit: 20 photos need only 4 requests.

import { askGemini, GeminiError } from "@/lib/gemini";
import { CATEGORIES, DesignTags, PRICE_BANDS, STYLES, parseTags } from "@/lib/designTags";
import { TAG_SYSTEM } from "@/lib/prompts";

const MAX_PER_REQUEST = 5;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Tells Gemini exactly which values are allowed, so it cannot invent new tags.
const TAG_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      isJewellery: { type: "BOOLEAN" },
      category: { type: "STRING", enum: [...CATEGORIES] },
      style: { type: "STRING", enum: [...STYLES] },
      priceBand: { type: "STRING", enum: [...PRICE_BANDS] },
      confidence: { type: "NUMBER" },
    },
    required: ["id", "isJewellery", "category", "style", "priceBand", "confidence"],
  },
};

type Photo = { id: string; image: string; mediaType: string };

export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      { error: "No API key found. Add GEMINI_API_KEY to the .env.local file and restart the app." },
      { status: 500 },
    );
  }

  let photos: Photo[];
  try {
    photos = (await request.json()).photos;
  } catch {
    return Response.json({ error: "The request was not valid." }, { status: 400 });
  }
  if (
    !Array.isArray(photos) ||
    photos.length === 0 ||
    photos.length > MAX_PER_REQUEST ||
    photos.some((p) => !p || typeof p.id !== "string" || !p.image || !ALLOWED_TYPES.includes(p.mediaType))
  ) {
    return Response.json({ error: "Those files are not photos we can read (use JPG, PNG or WebP, up to 5 at a time)." }, { status: 400 });
  }

  try {
    const text = await askGemini(
      TAG_SYSTEM,
      photos.flatMap((p) => [{ text: `Photo id: ${p.id}` }, { inlineData: { mimeType: p.mediaType, data: p.image } }]),
      300 * photos.length,
      TAG_SCHEMA,
    );
    const json = text.match(/\[[\s\S]*\]/)?.[0];
    let answers: unknown[] = [];
    try {
      answers = json ? JSON.parse(json) : [];
    } catch {
      // A garbled answer leaves every photo in this batch as null, so the screen asks for a hand review.
    }
    // Match each answer to its photo by id, and check it. Photos we got no valid answer for come back as null.
    const results: Record<string, DesignTags | null> = {};
    for (const p of photos) {
      const mine = answers.find((a) => typeof a === "object" && a !== null && (a as { id?: unknown }).id === p.id);
      results[p.id] = mine ? parseTags(mine) : null;
    }
    return Response.json({ results });
  } catch (e) {
    console.error("[api/tag]", e instanceof GeminiError ? `${e.message} (status ${e.status}, quota ${e.quota})` : e); // visible in the server log only
    if (e instanceof GeminiError && e.quota) {
      return Response.json({ error: "The daily limit of the free AI plan has been reached.", code: "quota" }, { status: 429 });
    }
    const status = e instanceof GeminiError ? e.status : undefined;
    const msg =
      status === 400 || status === 403 ? "The AI rejected these photos or the key. Check the key in .env.local."
      : status === 429 || status === 503 ? "The AI is busy right now. Press Retry in a moment."
      : "Could not reach the AI. Try again.";
    return Response.json({ error: msg }, { status: 502 });
  }
}
