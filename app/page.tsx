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

// The logo mark: a faceted gem, drawn inline so it needs no image file.
function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="gem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4c76a" />
          <stop offset="1" stopColor="#e8622c" />
        </linearGradient>
      </defs>
      <path d="M8 4h16l6 8-14 17L2 12z" fill="url(#gem)" />
      <path d="M2 12h28M11 4l5 8 5-8M16 12v17M8 4l8 8M24 4l-8 8" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
    </svg>
  );
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
  const [photosOpen, setPhotosOpen] = useState(true); // the photo grid is open while setting up, and folds away once results show
  const [tagsOpen, setTagsOpen] = useState(false);
  const [noKey, setNoKey] = useState(false); // true when the server has no GEMINI_API_KEY
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
    setPhotosOpen(true);
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
    setPhotosOpen(true);
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
        if (data.code === "nokey") setNoKey(true);
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
    setNoKey(false);
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
    if (found.length > 0 || !parsed) {
      setPhotosOpen(true); // the fix is usually in the photo cards (weight, quantity, date)
      return;
    }
    setPhotosOpen(false);
    setTagsOpen(false);

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


  const skipped = items.filter((i) => i.tags?.isJewellery === false);
  const shown = items.filter((i) => i.tags?.isJewellery !== false);
  const isPending = (i: Item) => !i.tags && (i.status === "waiting" || i.status === "tagging"); // still being tagged in the background
  const isUnsure = (i: Item) => !isPending(i) && !i.edited && (!i.tags || i.tags.confidence < LOW_CONFIDENCE);
  const unsureCount = analysis ? shown.filter(isUnsure).length : 0;
  const failedCount = items.filter((i) => i.status === "failed" && !i.tags).length;

  return (
    <div id="top" className="flex min-h-screen flex-col">
      {/* Hero band with the floating header */}
      <header className="hero">
        <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
          <nav className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 sm:px-6" style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.18)" }} aria-label="Main">
            <a href="#top" className="flex items-center gap-2.5">
              <Logo />
              <span className="text-lg tracking-tight" style={{ color: "var(--navy-900)" }}>
                <b className="font-extrabold">Zevar</b>
                <span className="font-medium"> IQ</span>
              </span>
            </a>
            <div className="hidden items-center gap-8 text-sm font-semibold md:flex" style={{ color: "var(--navy-900)" }}>
              <a href="#how" className="hover:opacity-70">
                How it works
              </a>
              <a href="#try" className="hover:opacity-70">
                Try it
              </a>
            </div>
            <a href="#try" className="btn btn-primary btn-sm">
              Try it free
            </a>
          </nav>

          <div className="mx-auto max-w-3xl pb-28 pt-12 text-center sm:pb-36 sm:pt-20">
            <span className="chip chip-gold">Built for independent jewellers in India</span>
            <h1 className="mt-5 text-3xl font-extrabold leading-tight sm:text-5xl">Know which designs sell, and which ones lock up your gold.</h1>
            <p className="mx-auto mt-4 max-w-2xl text-base sm:text-lg" style={{ color: "rgba(255,255,255,0.86)" }}>
              Upload your stock photos and your sales file. Zevar IQ shows what has not sold for 12 months and what to reorder from your karigars. You approve every decision.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a href="#try" className="btn btn-primary">
                Start with sample data
              </a>
              <a href="#how" className="btn" style={{ background: "rgba(255,255,255,0.12)", color: "#fff", borderColor: "rgba(255,255,255,0.35)" }}>
                How it works
              </a>
            </div>
            <ul className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>
              <li>✦ Stuck-gold number in under a second</li>
              <li>✦ AI reads every design photo</li>
              <li>✦ Nothing is sent to karigars</li>
            </ul>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto -mt-20 w-full max-w-6xl flex-1 space-y-6 px-4 pb-16 sm:-mt-28 sm:px-6">
        {/* The working card */}
        <section id="try" className="card scroll-mt-6 p-5 sm:p-8">
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <div className="flex items-center gap-3">
                <span className="step-num">1</span>
                <h2 className="text-lg font-bold">Stock photos</h2>
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                One photo per design. Then set grams, quantity and stock-in date for each.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} />
                <button className="btn btn-ghost btn-sm" onClick={loadSample} disabled={running}>
                  Try with sample data (20 photos)
                </button>
              </div>
              {items.length > 0 && !csvName.includes("(sample)") && (
                <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                  {items.length} photos added. Set grams, quantity and stock-in date for each under &quot;Photos and details&quot; below.
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center gap-3">
                <span className="step-num">2</span>
                <h2 className="text-lg font-bold">Sales file</h2>
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                CSV with columns design_id, date, amount. design_id must match the Design ID on each photo (it starts as the file name; you can edit it).
              </p>
              <div className="mt-4">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    setCsvText(f ? await f.text() : null);
                    setCsvName(f?.name ?? "");
                  }}
                />
              </div>
              {csvName && (
                <p className="mt-3 text-xs font-medium" style={{ color: "var(--good)" }}>
                  ✓ Loaded {csvName}
                </p>
              )}
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4 border-t pt-6" style={{ borderColor: "var(--line)" }}>
            <span className="step-num">3</span>
            <button className="btn btn-primary" disabled={running} onClick={analyseAll}>
              {running ? tagging || "Working…" : "Analyze"}
            </button>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              The stuck-gold summary appears instantly; the AI finishes tagging a few seconds later.
            </p>
          </div>
          {problems.length > 0 && (
            <ul className="alert alert-bad mt-5 list-disc space-y-1 pl-8">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </section>

        {noKey && (
          <p className="alert alert-warn">
            The AI is not set up on this server yet, so photos are not tagged and the reasons are basic. The stuck-gold banner and the board still work. The site owner needs to add
            GEMINI_API_KEY (Vercel: Settings, then Environment Variables) and redeploy.
          </p>
        )}

        {limitHit && (
          <p className="alert alert-warn">
            The daily limit of the free AI plan has been reached. The stuck-gold banner and the board still work. Photos that could not be tagged can be filled in by hand under
            &quot;Check the AI&apos;s tags&quot;, and the reasons will be basic. The limit resets every day, or you can turn on billing for your Gemini key.
          </p>
        )}

        {skipped.length > 0 && (
          <p className="alert alert-warn">
            The AI did not see jewellery in: {skipped.map((i) => i.id).join(", ")}. They are left out of the results.
          </p>
        )}

        {analysis && failedCount > 0 && !running && (
          <p className="alert alert-warn">
            {failedCount} {failedCount === 1 ? "photo" : "photos"} could not be tagged.{" "}
            <button
              className="font-bold underline"
              onClick={() => {
                setPhotosOpen(true);
                setTagsOpen(true);
              }}
            >
              Show them
            </button>{" "}
            to retry, or choose the tags by hand.
          </p>
        )}

        {analysis && (
          <Results
            analysis={analysis}
            thumbs={thumbs}
            reasons={reasons}
            reasonsState={reasonsState}
            tagging={tagging}
            seconds={seconds}
            excludedIds={skipped.map((i) => i.id)}
          />
        )}

        {items.length > 0 && (
          <details className="card p-5" open={photosOpen} onToggle={(e) => setPhotosOpen((e.target as HTMLDetailsElement).open)}>
            <summary>Photos and details ({items.length})</summary>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {items.map((i) => (
                <li key={i.id} className="flex gap-3 rounded-xl border p-3" style={{ borderColor: "var(--line)" }}>
                  <img src={i.preview} alt={i.id} className="h-20 w-20 flex-none rounded-xl object-cover" />
                  <div className="min-w-0 flex-1 space-y-2 text-sm">
                    <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--muted)" }}>
                      Design ID
                      <input
                        key={i.id}
                        className="input w-28 font-bold"
                        defaultValue={i.id}
                        onBlur={(e) => {
                          renameId(i.id, e.target.value);
                          e.target.value = i.id;
                        }}
                      />
                    </label>
                    <div className="flex flex-wrap gap-x-3 gap-y-2 text-xs font-semibold" style={{ color: "var(--muted)" }}>
                      <label className="flex items-center gap-1.5">
                        Grams
                        <input className="input w-16" inputMode="decimal" value={i.weight} onChange={(e) => patch(i.id, { weight: e.target.value })} />
                      </label>
                      <label className="flex items-center gap-1.5">
                        Qty
                        <input className="input w-14" inputMode="numeric" value={i.qty} onChange={(e) => patch(i.id, { qty: e.target.value })} />
                      </label>
                      <label className="flex items-center gap-1.5">
                        Stock-in
                        <input type="date" className="input" value={i.date} onChange={(e) => patch(i.id, { date: e.target.value })} />
                      </label>
                    </div>
                    {i.status === "failed" && (
                      <div className="text-xs font-medium" style={{ color: "var(--bad)" }}>
                        {i.error}{" "}
                        <button className="font-bold underline" onClick={() => tagBatch([i])}>
                          Retry
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}

        {analysis && (
          <details className="card p-5" open={tagsOpen} onToggle={(e) => setTagsOpen((e.target as HTMLDetailsElement).open)}>
            <summary>
              Check the AI&apos;s tags
              {unsureCount > 0 && <span className="chip chip-warn">{unsureCount} need review</span>}
            </summary>
            <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
              Amber means the AI was not sure. Change anything that looks wrong; results update straight away.
            </p>
            <ul className="mt-3 grid gap-3 md:grid-cols-2">
              {shown.map((i) => {
                const pending = isPending(i);
                const unsure = isUnsure(i);
                const set = (change: Partial<DesignTags>) =>
                  patch(i.id, {
                    edited: true,
                    tags: { isJewellery: true, category: "other", style: "other", priceBand: PRICE_BANDS[0], confidence: 1, ...i.tags, ...change },
                  });
                return (
                  <li
                    key={i.id}
                    className="flex gap-3 rounded-xl border p-3 text-xs"
                    style={{ borderColor: unsure ? "#e8c46a" : "var(--line)", background: unsure ? "var(--warn-soft)" : "#fff" }}
                  >
                    <img src={i.preview} alt={i.id} className="h-14 w-14 flex-none rounded-xl object-cover" />
                    <div className="min-w-0 space-y-1.5">
                      <div className="font-bold" style={{ color: "var(--ink)" }}>
                        {i.id} {pending && <span className="font-medium" style={{ color: "var(--muted)" }}>· tagging…</span>}
                        {unsure && (
                          <span className="font-semibold" style={{ color: "var(--warn)" }}>
                            · needs review{i.tags ? ` (${Math.round(i.tags.confidence * 100)}% sure)` : " (not tagged)"}
                          </span>
                        )}
                        {i.edited && <span className="font-medium" style={{ color: "var(--muted)" }}> · edited by you</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <select className="input" value={i.tags?.category ?? ""} onChange={(e) => set({ category: e.target.value as DesignTags["category"] })}>
                          {!i.tags && <option value="">category?</option>}
                          {CATEGORIES.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                        <select className="input" value={i.tags?.style ?? ""} onChange={(e) => set({ style: e.target.value as DesignTags["style"] })}>
                          {!i.tags && <option value="">style?</option>}
                          {STYLES.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                        <select className="input" value={i.tags?.priceBand ?? ""} onChange={(e) => set({ priceBand: e.target.value as DesignTags["priceBand"] })}>
                          {!i.tags && <option value="">price?</option>}
                          {PRICE_BANDS.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        )}

        {/* How it works */}
        <section id="how" className="scroll-mt-6 pt-10">
          <div className="mx-auto max-w-2xl text-center">
            <span className="chip chip-gold">How it works</span>
            <h2 className="mt-3 text-2xl font-extrabold sm:text-3xl">From photo to reorder list in three steps</h2>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              AI is used only where the input is fuzzy: reading a design from a photo, and explaining a pick. Everything else is plain arithmetic you can check.
            </p>
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              { n: "1", t: "AI reads each design", d: "Each photo is tagged with a category, style and price band from a fixed list, and anything it is unsure about is flagged for you." },
              { n: "2", t: "Plain maths finds stuck stock", d: "Your sales file is matched to designs. Anything unsold for 12 months with stock left is stuck, and its gold is added up." },
              { n: "3", t: "You decide what to reorder", d: "You get a reorder list and a do-not-reorder list with a reason for each. Approve or edit every item. Nothing is sent to a karigar." },
            ].map((s) => (
              <div key={s.n} className="card p-6">
                <span className="step-num" style={{ background: "var(--gold)" }}>
                  {s.n}
                </span>
                <h3 className="mt-4 text-base font-bold">{s.t}</h3>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  {s.d}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mt-auto" style={{ background: "var(--navy-900)", color: "rgba(255,255,255,0.75)" }}>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-xs sm:px-6">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="text-sm font-semibold text-white">Zevar IQ</span>
            <span>· A hackathon MVP for independent jewellers</span>
          </div>
          <a href="/sample/photos/CREDITS.md" className="underline hover:text-white">
            Sample photo credits (Wikimedia Commons)
          </a>
        </div>
      </footer>
    </div>
  );
}
