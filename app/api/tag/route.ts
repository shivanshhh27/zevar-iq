// Runs on the server so the API key never reaches the browser.
// Receives one photo, asks Claude to tag it, checks the answer, sends it back.

import Anthropic from "@anthropic-ai/sdk";
import { parseTags } from "@/lib/designTags";
import { TAG_SYSTEM } from "@/lib/prompts";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type MediaType = (typeof ALLOWED_TYPES)[number];

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "No API key found. Add ANTHROPIC_API_KEY to the .env.local file and restart the app." },
      { status: 500 },
    );
  }

  let body: { image?: string; mediaType?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The request was not valid." }, { status: 400 });
  }
  if (!body.image || !ALLOWED_TYPES.includes(body.mediaType as MediaType)) {
    return Response.json({ error: "That file is not a photo we can read (use JPG, PNG or WebP)." }, { status: 400 });
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 300,
      system: TAG_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: body.mediaType as MediaType, data: body.image } },
            { type: "text", text: "Tag this piece." },
          ],
        },
      ],
    });
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    const tags = json ? parseTags(JSON.parse(json)) : null;
    if (!tags) {
      return Response.json({ error: "Claude's answer could not be read. Please review this piece by hand." }, { status: 502 });
    }
    return Response.json({ tags });
  } catch {
    return Response.json({ error: "Could not reach Claude for this photo. Try again." }, { status: 502 });
  }
}
