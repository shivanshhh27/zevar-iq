"use client";
/* eslint-disable @next/next/no-img-element -- previews are in-memory data URLs, so next/image does not apply */

// The one screen: add photos, add the sales file, press Analyze, read the results.

import { useMemo, useRef, useState } from "react";
import Results, { Reasons } from "@/components/Results";
import { analyse, StockItem } from "@/lib/analysis";
import { parseSalesCsv, SaleRow } from "@/lib/csv";
import { CATEGORIES, DesignTags, LOW_CONFIDENCE, PRICE_BANDS, STYLES } from "@/lib/designTags";

type Item = {
  id: string; // file name without extension; must match design_id in the sales file
  preview: string;
  image: string; // base64 of a shrunk copy, sent to the server
  weight: string;
  qty: string;
  date: string;
  status: "waiting" | "tagging" | "done" | "failed";
  error?: string;
  tags?: DesignTags;
  edited?: boolean;
};

// Shrinks a photo to 1024px so uploads are fast and cheap. Returns null if the file can't be read as an image.
async function shrink(file: File): Promise<{ preview: string; image: string } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    return { preview: url, image: url.split(",")[1] };
  } catch {
    return null;
  }
}

// Kept outside the component so the stopwatch is not treated as part of drawing the screen.
const clock = { now: () => Date.now() };

const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// Non-jewellery photos are left out. Photos the AI failed on stay in, untagged.
function toStock(items: Item[]): StockItem[] {
  return items
    .filter((i) => i.tags?.isJewellery !== false)
    .map((i) => ({ id: i.id, weightGrams: Number(i.weight), quantity: Number(i.qty), karigar: "", stockInDate: i.date, tags: i.tags ?? null }));
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [csvName, setCsvName] = useState("");
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [reasons, setReasons] = useState<Reasons>({});
  const [reasonsState, setReasonsState] = useState<"loading" | "ai" | "fallback">("loading");
  const itemsRef = useRef<Item[]>([]);

  const update = (next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const patch = (id: string, change: Partial<Item>) => update(itemsRef.current.map((i) => (i.id === id ? { ...i, ...change } : i)));

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const added: Item[] = [];
    const skipped: string[] = [];
    for (const file of Array.from(files)) {
      const small = await shrink(file);
      if (!small) {
        skipped.push(file.name);
        continue;
      }
      let id = file.name.replace(/\.[^.]+$/, "");
      while (itemsRef.current.concat(added).some((i) => i.id === id)) id += "_2";
      added.push({ id, ...small, weight: "", qty: "1", date: "", status: "waiting" });
    }
    update([...itemsRef.current, ...added]);
    setProblems(skipped.length ? [`These files are not photos we can read and were skipped: ${skipped.join(", ")}.`] : []);
  }

  async function tagOne(item: Item) {
    patch(item.id, { status: "tagging", error: undefined });
    try {
      const res = await fetch("/api/tag", { method: "POST", body: JSON.stringify({ image: item.image, mediaType: "image/jpeg" }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      patch(item.id, { status: "done", tags: data.tags });
    } catch (e) {
      patch(item.id, { status: "failed", error: e instanceof Error ? e.message : "Could not tag this photo." });
    }
  }

  // Asks the AI for a reason per design (once per run). If it fails, the screen shows basic reasons.
  function requestReasons(result: ReturnType<typeof analyse>) {
    const lines = [...result.reorder, ...result.stuck].map((r) => ({
      id: r.id,
      list: r.stuck ? "do-not-reorder" : "reorder",
      category: r.tags?.category ?? "unknown",
      style: r.tags?.style ?? "unknown",
      grams: r.weightGrams,
      sold: r.sold,
      quantity: r.quantity,
      idleDays: r.idleDays,
    }));
    if (lines.length === 0) return setReasonsState("ai");
    fetch("/api/reorder", { method: "POST", body: JSON.stringify({ lines }) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setReasons(d.reasons);
        setReasonsState("ai");
      })
      .catch(() => setReasonsState("fallback"));
  }

  async function analyseAll() {
    const found: string[] = [];
    if (items.length === 0) found.push("Add at least one photo.");
    if (csvText === null) found.push("Add the sales file (CSV).");
    for (const i of items) {
      if (!(Number(i.weight) > 0)) found.push(`${i.id}: enter the weight in grams.`);
      if (!(Number.isInteger(Number(i.qty)) && Number(i.qty) >= 1)) found.push(`${i.id}: quantity must be a whole number, 1 or more.`);
      if (!validDate(i.date)) found.push(`${i.id}: enter the stock-in date.`);
    }
    let parsed: SaleRow[] | null = null;
    if (csvText !== null) {
      const result = parseSalesCsv(csvText);
      if (result.ok) parsed = result.sales;
      else found.push(result.error);
    }
    setProblems(found);
    if (found.length > 0 || !parsed) return;

    const start = clock.now();
    setRunning(true);
    setSales(null);
    setReasonsState("loading");
    setReasons({});

    // Tag 5 photos at a time.
    const queue = itemsRef.current.filter((i) => !i.tags);
    const total = queue.length;
    let done = 0;
    setProgress(`Tagging 0 of ${total}`);
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          await tagOne(next);
          setProgress(`Tagging ${++done} of ${total}`);
        }
      }),
    );

    setSales(parsed);
    requestReasons(analyse(toStock(itemsRef.current), parsed));
    setSeconds(Math.round((clock.now() - start) / 1000));
    setRunning(false);
    setProgress("");
  }

  const analysis = useMemo(() => (sales ? analyse(toStock(items), sales) : null), [sales, items]);
  const thumbs = Object.fromEntries(items.map((i) => [i.id, i.preview]));


  const field = "w-20 rounded border px-1 py-0.5 text-sm";
  const skipped = items.filter((i) => i.tags?.isJewellery === false);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">DesignLedger</h1>
        <p className="text-sm text-zinc-600">Upload stock photos and your sales file. See which designs are stuck and what to reorder.</p>
      </header>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">1. Stock photos</h2>
        <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} />
        {items.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((i) => (
              <li key={i.id} className="flex gap-3 rounded border p-2">
                <img src={i.preview} alt={i.id} className="h-20 w-20 rounded object-cover" />
                <div className="flex-1 space-y-1 text-sm">
                  <div className="font-medium">{i.id}</div>
                  <div className="flex flex-wrap gap-2">
                    <label>
                      Grams <input className={field} inputMode="decimal" value={i.weight} onChange={(e) => patch(i.id, { weight: e.target.value })} />
                    </label>
                    <label>
                      Qty <input className={field} inputMode="numeric" value={i.qty} onChange={(e) => patch(i.id, { qty: e.target.value })} />
                    </label>
                    <label>
                      Stock-in <input type="date" className="rounded border px-1 py-0.5 text-sm" value={i.date} onChange={(e) => patch(i.id, { date: e.target.value })} />
                    </label>
                  </div>
                  {i.status === "failed" && (
                    <div className="text-xs text-red-700">
                      {i.error} <button className="underline" onClick={() => tagOne(i)}>Retry</button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="font-semibold">2. Sales file</h2>
        <p className="text-xs text-zinc-500">CSV with columns design_id, date, amount. design_id must match the photo file name (without .jpg).</p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setCsvText(f ? await f.text() : null);
            setCsvName(f?.name ?? "");
          }}
        />
        {csvName && <p className="text-xs text-zinc-500">Loaded {csvName}</p>}
      </section>

      <div className="space-y-2">
        <button className="rounded bg-black px-4 py-2 text-white disabled:opacity-50" disabled={running} onClick={analyseAll}>
          {running ? progress || "Working…" : "Analyze"}
        </button>
        {problems.length > 0 && (
          <ul className="list-disc rounded bg-red-50 p-3 pl-7 text-sm text-red-800">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>

      {skipped.length > 0 && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
          The AI did not see jewellery in: {skipped.map((i) => i.id).join(", ")}. They are left out of the results.
        </p>
      )}

      {analysis && (
        <>
          <section className="space-y-2 rounded-lg border p-4">
            <h2 className="font-semibold">Check the AI&apos;s tags</h2>
            <p className="text-xs text-zinc-500">Amber means the AI was not sure. Change anything that looks wrong; results update straight away.</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.filter((i) => i.tags?.isJewellery !== false).map((i) => {
                const unsure = !i.edited && (!i.tags || i.tags.confidence < LOW_CONFIDENCE);
                const set = (change: Partial<DesignTags>) =>
                  patch(i.id, {
                    edited: true,
                    tags: { isJewellery: true, category: "other", style: "other", priceBand: PRICE_BANDS[0], confidence: 1, ...i.tags, ...change },
                  });
                return (
                  <li key={i.id} className={`flex gap-2 rounded border p-2 text-xs ${unsure ? "border-amber-400 bg-amber-50" : ""}`}>
                    <img src={i.preview} alt={i.id} className="h-14 w-14 rounded object-cover" />
                    <div className="space-y-1">
                      <div className="font-medium">
                        {i.id} {unsure && <span className="text-amber-800">· needs review{i.tags ? ` (${Math.round(i.tags.confidence * 100)}% sure)` : " (not tagged)"}</span>}
                        {i.edited && <span className="text-zinc-500"> · edited by you</span>}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <select value={i.tags?.category ?? ""} onChange={(e) => set({ category: e.target.value as DesignTags["category"] })}>
                          {!i.tags && <option value="">category?</option>}
                          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                        </select>
                        <select value={i.tags?.style ?? ""} onChange={(e) => set({ style: e.target.value as DesignTags["style"] })}>
                          {!i.tags && <option value="">style?</option>}
                          {STYLES.map((c) => <option key={c}>{c}</option>)}
                        </select>
                        <select value={i.tags?.priceBand ?? ""} onChange={(e) => set({ priceBand: e.target.value as DesignTags["priceBand"] })}>
                          {!i.tags && <option value="">price?</option>}
                          {PRICE_BANDS.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <Results analysis={analysis} thumbs={thumbs} reasons={reasons} reasonsState={reasonsState} seconds={seconds} />
        </>
      )}
    </main>
  );
}
