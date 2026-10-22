// Asks Claude to write a short reason for each design already ranked by our code.
// If anything fails, the screen falls back to its own plain-text reasons.

import Anthropic from "@anthropic-ai/sdk";
import { REORDER_SYSTEM } from "@/lib/prompts";

type Line = { id: string; list: "reorder" | "do-not-reorder"; category: string; style: string; grams: number; sold: number; quantity: number; idleDays: number };

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "No API key found." }, { status: 500 });

  let lines: Line[];
  try {
    lines = (await request.json()).lines;
    if (!Array.isArray(lines) || lines.length === 0) throw new Error();
  } catch {
    return Response.json({ error: "Nothing to explain." }, { status: 400 });
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 1500,
      system: REORDER_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(lines) }],
    });
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    const raw = json ? JSON.parse(json) : null;
    if (!raw || typeof raw !== "object") throw new Error();
    const reasons: Record<string, string> = {};
    for (const l of lines) if (typeof raw[l.id] === "string") reasons[l.id] = raw[l.id];
    return Response.json({ reasons });
  } catch {
    return Response.json({ error: "Could not get reasons from Claude." }, { status: 502 });
  }
}
