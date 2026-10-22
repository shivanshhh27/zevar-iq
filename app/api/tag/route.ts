// Runs on the server so the API key never reaches the browser.
// Receives one photo, asks Gemini to tag it, checks the answer, sends it back.

import { askGemini, GeminiError } from "@/lib/gemini";
import { CATEGORIES, PRICE_BANDS, STYLES, parseTags } from "@/lib/designTags";
import { TAG_SYSTEM } from "@/lib/prompts";

// Tells Gemini exactly which values are allowed, so it cannot invent new tags.
const TAG_SCHEMA = {
  type: "OBJECT",
  properties: {
    isJewellery: { type: "BOOLEAN" },
    category: { type: "STRING", enum: [...CATEGORIES] },
    style: { type: "STRING", enum: [...STYLES] },
    priceBand: { type: "STRING", enum: [...PRICE_BANDS] },
    confidence: { type: "NUMBER" },
  },
  required: ["isJewellery", "category", "style", "priceBand", "confidence"],
};

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      { error: "No API key found. Add GEMINI_API_KEY to the .env.local file and restart the app." },
      { status: 500 },
    );
  }

  let body: { image?: string; mediaType?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The request was not valid." }, { status: 400 });
  }
  if (!body.image || !body.mediaType || !ALLOWED_TYPES.includes(body.mediaType)) {
    return Response.json({ error: "That file is not a photo we can read (use JPG, PNG or WebP)." }, { status: 400 });
  }

  try {
    const text = await askGemini(
      TAG_SYSTEM,
      [{ inlineData: { mimeType: body.mediaType, data: body.image } }, { text: "Tag this piece." }],
      600,
      TAG_SCHEMA,
    );
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    const tags = json ? parseTags(JSON.parse(json)) : null;
    if (!tags) {
      return Response.json({ error: "The AI's answer could not be read. Please review this piece by hand." }, { status: 502 });
    }
    return Response.json({ tags });
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : undefined;
    const msg =
      status === 400 || status === 403 ? "The AI rejected this photo or the key. Check the key in .env.local."
      : status === 429 || status === 503 ? "The AI is busy right now. Press Retry in a moment."
      : "Could not reach the AI for this photo. Try again.";
    return Response.json({ error: msg }, { status: 502 });
  }
}
