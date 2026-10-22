// One small helper for talking to Gemini from our server routes.
// Uses Gemini's plain web API, so no extra library is needed.

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export class GeminiError extends Error {}

// Sends a system instruction plus parts (text and/or a base64 image) and returns Gemini's JSON answer as text.
export async function askGemini(
  system: string,
  parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[],
  maxOutputTokens: number,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("NO_KEY");

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens, temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new GeminiError(`Gemini returned ${res.status}`);
  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new GeminiError("Empty answer");
  return text;
}
