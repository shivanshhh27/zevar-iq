// Asks Gemini to write a short reason for each design already ranked by our code.
// If anything fails, the screen falls back to its own plain-text reasons.

// Vercel stops a request after this many seconds (the free plan allows up to 60).
export const maxDuration = 60;

import { askGemini, GeminiError } from "@/lib/gemini";
import { REORDER_SYSTEM } from "@/lib/prompts";

type Line = { id: string; list: "reorder" | "do-not-reorder"; category: string; style: string; grams: number; sold: number; quantity: number; idleDays: number; lockedGrams: number; styleSoldPercent: number; categorySoldPercent: number };

export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY) return Response.json({ error: "No API key found." }, { status: 500 });

  let lines: Line[];
  try {
    lines = (await request.json()).lines;
    if (!Array.isArray(lines) || lines.length === 0) throw new Error();
  } catch {
    return Response.json({ error: "Nothing to explain." }, { status: 400 });
  }

  try {
    const text = await askGemini(REORDER_SYSTEM, [{ text: JSON.stringify(lines) }], 2500);
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    const raw = json ? JSON.parse(json) : null;
    if (!raw || typeof raw !== "object") throw new Error();
    const reasons: Record<string, string> = {};
    for (const l of lines) if (typeof raw[l.id] === "string") reasons[l.id] = raw[l.id];
    return Response.json({ reasons });
  } catch (e) {
    if (e instanceof GeminiError && e.quota) {
      return Response.json({ error: "The daily limit of the free AI plan has been reached.", code: "quota" }, { status: 429 });
    }
    return Response.json({ error: "Could not get reasons from the AI." }, { status: 502 });
  }
}
