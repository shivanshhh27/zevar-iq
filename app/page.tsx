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

// Shrinks a photo to 768px so uploads are fast and cheap. Returns null if the file can't be read as an image.
async function shrink(file: File): Promise<{ preview: string; image: string } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 768 / Math.max(bitmap.width, bitmap.height));
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
  const [seconds, setSeconds] = useState(0);
  const [tagging, setTagging] = useState(""); // progress text while photos are being tagged
  const [limitHit, setLimitHit] = useState(false); // true when Gemini says the free daily limit is used up
  const [reasons, setReasons] = useState<Reasons>({});
  const [reasonsState, setReasonsState] = useState<"loading" | "ai" | "fallback">("loading");
  const itemsRef = useRef<Item[]>([]);

  const update = (next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const patch = (id: string, change: Partial<Item>) => update(itemsRef.current.map((i) => (i.id === id ? { ...i, ...change } : i)));

  // Lets the owner fix a design ID so it matches the sales file (it starts as the photo's file name).
  function renameId(oldId: string, raw: string) {
    const id = raw.trim();
    if (!id || id === oldId) return;
    if (itemsRef.current.some((i) => i.id === id)) {
      setProblems([`Design ID ${id} is already used by another photo.`]);
      return;
    }
    update(itemsRef.current.map((i) => (i.id === oldId ? { ...i, id } : i)));
  }

  // One click fills the form with the 20 sample photos, their weights and dates, and the sample sales file.
  async function loadSample() {
    setSales(null);
    setProblems([]);
    setTagging("");
    try {
      const stock: { id: string; weightGrams: number; quantity: number; stockInDate: string }[] = await (await fetch("/sample/stock.json")).json();
      const loaded = await Promise.all(
        stock.map(async (s) => {
          const file = new File([await (await fetch(`/sample/photos/${s.id}.jpg`)).blob()], `${s.id}.jpg`, { type: "image/jpeg" });
          const small = await shrink(file);
          if (!small) throw new Error(s.id);
          return { id: s.id, ...small, weight: String(s.weightGrams), qty: String(s.quantity), date: s.stockInDate, status: "waiting" } as Item;
        }),
      );
      update(loaded);
      setCsvText(await (await fetch("/sample/sales.csv")).text());
      setCsvName("sales.csv (sample)");
    } catch {
      setProblems(["Could not load the sample data. Refresh the page and try again."]);
    }
  }

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

  // Sends up to 5 photos to the AI in ONE request (the free plan allows only a small number of requests per day).
  async function tagBatch(batch: Item[]) {
    for (const item of batch) patch(item.id, { status: "tagging", error: undefined });
    const fail = (message: string) => {
      for (const item of batch) patch(item.id, { status: "failed", error: message });
    };
    try {
      const res = await fetch("/api/tag", {
        method: "POST",
        body: JSON.stringify({ photos: batch.map((i) => ({ id: i.id, image: i.image, mediaType: "image/jpeg" })) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "quota") setLimitHit(true);
        return fail(data.code === "quota" ? "Daily AI limit reached. Tag this one by hand below, or Retry later." : data.error);
      }
      for (const item of batch) {
        const tags = data.results?.[item.id];
        if (tags) patch(item.id, { status: "done", tags });
        else patch(item.id, { status: "failed", error: "The AI's answer for this photo could not be read. Review it by hand below." });
      }
    } catch {
      fail("Could not tag this photo. Check your connection and Retry.");
    }
  }

  // Asks the AI for a reason per design (once per run). If it fails, the screen shows basic reasons.
  function requestReasons(result: ReturnType<typeof analyse>) {
    // How well each style / category sells across the whole shop, so reasons can compare a design with its peers.
    const share = (key: (r: (typeof result.rows)[number]) => string) => {
      const totals = new Map<string, { sold: number; pieces: number }>();
      for (const r of result.rows) {
        const t = totals.get(key(r)) ?? { sold: 0, pieces: 0 };
        totals.set(key(r), { sold: t.sold + Math.min(r.sold, r.quantity), pieces: t.pieces + r.quantity });
      }
      return (r: (typeof result.rows)[number]) => {
        const t = totals.get(key(r))!;
        return Math.round((t.sold / t.pieces) * 100);
      };
    };
    const styleShare = share((r) => r.tags?.style ?? "unknown");
    const categoryShare = share((r) => r.tags?.category ?? "unknown");
    const lines = [...result.reorder, ...result.stuck].map((r) => ({
      id: r.id,
      list: r.stuck ? "do-not-reorder" : "reorder",
      category: r.tags?.category ?? "unknown",
      style: r.tags?.style ?? "unknown",
      grams: r.weightGrams,
      sold: r.sold,
      quantity: r.quantity,
      idleDays: r.idleDays,
      lockedGrams: Math.round(r.lockedGrams * 10) / 10,
      styleSoldPercent: styleShare(r),
      categorySoldPercent: categoryShare(r),
    }));
    if (lines.length === 0) return setReasonsState("ai");
    fetch("/api/reorder", { method: "POST", body: JSON.stringify({ lines }) })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          if (d.code === "quota") setLimitHit(true);
          throw new Error(d.error);
        }
        return d;
      })
      .then((d) => {
        setReasons(d.reasons);
        setReasonsState("ai");
      })
      .catch(() => setReasonsState("fallback"));
  }

  async function analyseAll() {
    setSales(null); // never leave old results on screen next to a new run or a new error
    setTagging("");
    setLimitHit(false);
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

    // The stuck-gold banner only needs weights, dates and sales, not the AI, so show it straight away.
    // Photo tagging then runs in the background and fills in styles and price bands as it goes.
    const start = clock.now();
    setRunning(true);
    setReasonsState("loading");
    setReasons({});
    setSales(parsed);

    // Photos go to the AI 5 at a time, one request per batch; 4 batches (20 photos) run at once.
    const todo = itemsRef.current.filter((i) => !i.tags);
    const batches: Item[][] = [];
    for (let n = 0; n < todo.length; n += 5) batches.push(todo.slice(n, n + 5));
    let done = 0;
    setTagging(todo.length > 0 ? `Tagging 0 of ${todo.length}` : "");
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let next = batches.shift(); next; next = batches.shift()) {
          await tagBatch(next);
          done += next.length;
          setTagging(`Tagging ${done} of ${todo.length}`);
        }
      }),
    );

    setTagging("");
    setSeconds(Math.round((clock.now() - start) / 1000));
    setRunning(false);
    requestReasons(analyse(toStock(itemsRef.current), parsed));
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
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} />
          <button className="rounded border px-3 py-1 text-sm" onClick={loadSample} disabled={running}>
            Try with sample data (20 photos)
          </button>
        </div>
        {items.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((i) => (
              <li key={i.id} className="flex gap-3 rounded border p-2">
                <img src={i.preview} alt={i.id} className="h-20 w-20 rounded object-cover" />
                <div className="flex-1 space-y-1 text-sm">
                  <label className="block">
                    Design ID{" "}
                    <input
                      key={i.id}
                      className="w-24 rounded border px-1 py-0.5 text-sm font-medium"
                      defaultValue={i.id}
                      onBlur={(e) => {
                        renameId(i.id, e.target.value);
                        e.target.value = i.id;
                      }}
                    />
                  </label>
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
                      {i.error} <button className="underline" onClick={() => tagBatch([i])}>Retry</button>
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
        <p className="text-xs text-zinc-500">CSV with columns design_id, date, amount. design_id must match the Design ID on each photo (it starts as the file name; you can edit it).</p>
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
          {running ? tagging || "Working…" : "Analyze"}
        </button>
        {problems.length > 0 && (
          <ul className="list-disc rounded bg-red-50 p-3 pl-7 text-sm text-red-800">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>

      {limitHit && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
          The daily limit of the free AI plan has been reached. The stuck-gold banner and the board still work. Photos that could not be tagged can be filled in by hand under
          &quot;Check the AI&apos;s tags&quot;, and the reasons will be basic. The limit resets every day, or you can turn on billing for your Gemini key.
        </p>
      )}

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
                const pending = !i.tags && (i.status === "waiting" || i.status === "tagging"); // still being tagged in the background
                const unsure = !pending && !i.edited && (!i.tags || i.tags.confidence < LOW_CONFIDENCE);
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
                        {i.id} {pending && <span className="text-zinc-500">· tagging…</span>}{unsure && <span className="text-amber-800">· needs review{i.tags ? ` (${Math.round(i.tags.confidence * 100)}% sure)` : " (not tagged)"}</span>}
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
          <Results analysis={analysis} thumbs={thumbs} reasons={reasons} reasonsState={reasonsState} tagging={tagging} seconds={seconds} excludedIds={skipped.map((i) => i.id)} />
        </>
      )}
    </main>
  );
}
