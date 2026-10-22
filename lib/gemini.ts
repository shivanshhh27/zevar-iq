// One small helper for talking to Gemini from our server routes.
// Uses Gemini's plain web API, so no extra library is needed.

const MODELS = [process.env.GEMINI_MODEL || "gemini-3.8-flash", "gemini-3.5-flash"]; // second is the backup when the first is busy

export class GeminiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sends a system instruction plus parts (text and/or a base64 image) and returns Gemini's JSON answer as text.
// If Google is busy (429 or 503) we wait a moment and retry, then try the backup model.
export async function askGemini(
  system: string,
  parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[],
  maxOutputTokens: number,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("NO_KEY");

  let last: GeminiError = new GeminiError("Gemini failed");
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(800 * attempt);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens, temperature: 0.2 },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text: string | undefined = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
        if (text) return text;
        last = new GeminiError("Empty answer", 200);
        continue;
      }
      last = new GeminiError(`Gemini returned ${res.status}`, res.status);
      if (res.status !== 429 && res.status !== 503) break; // not a busy signal, so retrying will not help
    }
  }
  throw last;
}
