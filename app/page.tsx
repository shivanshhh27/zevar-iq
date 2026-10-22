"use client";
/* eslint-disable @next/next/no-img-element -- previews are in-memory data URLs, so next/image does not apply */

// The one screen: add photos, add the sales file, press Analyze, read the results.

import { useMemo, useRef, useState } from "react";
import Results, { Reasons } from "@/components/Results";
import { analyse, StockItem } from "@/lib/analysis";
import { parseSalesCsv, SaleRow } from "@/lib/csv";
import { Category, CATEGORIES, DesignTags, LOW_CONFIDENCE, PRICE_BANDS, STYLES } from "@/lib/designTags";
import { categoryForOrnament, parseStockCsv, StockRow } from "@/lib/stockCsv";

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
  name?: string; // from the stock list, e.g. "Lakshmi Kasu Mala"
  ornament?: string; // from the stock list, e.g. "Necklace"
  karigar?: string;
  ornamentCategory?: Category; // the category the stock list's ornament type maps to; it wins over the AI's guess
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
    .map((i) => ({
      id: i.id,
      weightGrams: Number(i.weight),
      quantity: Number(i.qty),
      karigar: i.karigar ?? "",
      name: i.name,
      ornament: i.ornament,
      stockInDate: i.date,
      tags: i.tags ?? null,
    }));
}

// The logo mark: a faceted gem in gold, drawn inline so it needs no image file.
function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="gem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6d27a" />
          <stop offset="1" stopColor="#d8962c" />
        </linearGradient>
      </defs>
      <path d="M8 4h16l6 8-14 17L2 12z" fill="url(#gem)" />
      <path d="M2 12h28M11 4l5 8 5-8M16 12v17M8 4l8 8M24 4l-8 8" stroke="#fff" strokeOpacity="0.75" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

// A small set of line icons (drawn inline) for the feature cards.
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    bag: <path d="M6 8h12l1 12H5L6 8zm3 0a3 3 0 016 0" />,
    gem: <path d="M7 4h10l4 5-9 11L3 9l4-5zm-4 5h18M10 4l2 5 2-5" />,
    chart: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
    bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
    eye: <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 100 6 3 3 0 000-6z" />,
    check: <path d="M5 13l4 4L19 7" />,
    file: <path d="M7 3h7l5 5v13H7V3zm7 0v5h5M10 13h6M10 17h6" />,
  };
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

// The hero artwork: a soft gold shape, a sample dashboard card, and the three things being tracked.
// All numbers here are from the built-in sample data and are labelled as a sample.
function HeroArt() {
  const bars = [38, 62, 44, 80, 55, 70];
  return (
    <div className="relative mx-auto h-[380px] w-full max-w-[540px] sm:h-[430px]" aria-hidden="true">
      <svg viewBox="0 0 540 430" className="absolute inset-0 h-full w-full">
        <path d="M120 70c60-60 190-62 260-10s112 140 70 220-150 130-250 112S40 330 30 230 60 130 120 70z" fill="#f7e4a6" />
        <circle cx="96" cy="64" r="22" fill="#f3d98b" />
        <path d="M60 300c40 60 150 100 240 90" stroke="#d8962c" strokeOpacity="0.5" strokeWidth="2" fill="none" />
      </svg>
      <div className="absolute left-3 top-10 w-[300px] rounded-2xl bg-white p-5 sm:left-8 sm:w-[340px]" style={{ boxShadow: "0 20px 50px rgba(80,50,0,0.18)" }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
            Stuck gold
          </span>
          <span className="chip chip-gold">Sample data</span>
        </div>
        <div className="mt-2 text-4xl font-extrabold" style={{ color: "var(--ink)" }}>
          243 <span className="text-lg font-bold">g</span>
        </div>
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          6 designs unsold for 12 months
        </div>
        <div className="mt-4 flex h-16 items-end gap-2">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-md" style={{ height: h + "%", background: i === 3 ? "var(--gold)" : "#f1e2b4" }} />
          ))}
        </div>
      </div>
      <div className="absolute bottom-6 right-0 w-[210px] space-y-3 sm:right-2">
        {[
          { icon: "bag", label: "Purchases", value: "30 pieces" },
          { icon: "gem", label: "Inventory", value: "20 designs" },
          { icon: "chart", label: "Sales", value: "16 sold" },
        ].map((t) => (
          <div key={t.label} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3" style={{ boxShadow: "0 12px 30px rgba(80,50,0,0.16)" }}>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "var(--cream)", color: "var(--gold)" }}>
              <Icon name={t.icon} />
            </span>
            <div className="leading-tight">
              <div className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                {t.label}
              </div>
              <div className="text-sm font-extrabold" style={{ color: "var(--ink)" }}>
                {t.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
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
  const stockRowsRef = useRef<StockRow[]>([]); // the uploaded stock list, kept so photos added later can be filled in too
  const [stockName, setStockName] = useState("");
  const [stockNote, setStockNote] = useState("");

  const update = (next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const patch = (id: string, change: Partial<Item>) => update(itemsRef.current.map((i) => (i.id === id ? { ...i, ...change } : i)));

  // Fills in grams, quantity, date, name and ornament type from the stock list.
  // `onlyIds` limits it to some photos, so it never overwrites what the owner typed for the others.
  function applyStock(rows: StockRow[], onlyIds?: string[]) {
    const byId = new Map(rows.map((r) => [r.id.toLowerCase(), r]));
    const used = new Set<string>();
    const next = itemsRef.current.map((i) => {
      const r = byId.get(i.id.toLowerCase());
      if (!r || (onlyIds && !onlyIds.includes(i.id))) return i;
      used.add(r.id.toLowerCase());
      const cat = categoryForOrnament(r.ornament);
      return {
        ...i,
        weight: String(r.weightGrams),
        qty: String(r.quantity),
        date: r.stockInDate,
        name: r.name || undefined,
        ornament: r.ornament || undefined,
        karigar: r.karigar || undefined,
        ornamentCategory: cat,
        tags: i.tags && cat ? { ...i.tags, category: cat } : i.tags,
      };
    });
    update(next);
    if (onlyIds) return;
    const noRow = next.filter((i) => !byId.has(i.id.toLowerCase())).map((i) => i.id);
    const noPhoto = rows.filter((r) => !used.has(r.id.toLowerCase())).length;
    setStockNote(
      next.length === 0
        ? `${rows.length} designs loaded. They fill in each photo's details as you add photos.`
        : `Filled in ${used.size} of ${next.length} photos from the stock list.` +
            (noRow.length ? ` No row for: ${noRow.join(", ")}.` : "") +
            (noPhoto ? ` ${noPhoto} list ${noPhoto === 1 ? "row has" : "rows have"} no photo yet.` : ""),
    );
  }

  async function onStockFile(file: File | undefined) {
    setStockNote("");
    if (!file) {
      stockRowsRef.current = [];
      setStockName("");
      return;
    }
    const result = parseStockCsv(await file.text());
    if (!result.ok) {
      stockRowsRef.current = [];
      setStockName("");
      setProblems([result.error]);
      return;
    }
    stockRowsRef.current = result.rows;
    setStockName(file.name);
    setProblems([]);
    applyStock(result.rows);
  }

  // Lets the owner fix a design ID so it matches the sales file (it starts as the photo's file name).
  function renameId(oldId: string, raw: string) {
    const id = raw.trim();
    if (!id || id === oldId) return;
    if (itemsRef.current.some((i) => i.id === id)) {
      setProblems([`Design ID ${id} is already used by another photo.`]);
      return;
    }
    update(itemsRef.current.map((i) => (i.id === oldId ? { ...i, id } : i)));
    if (stockRowsRef.current.length) applyStock(stockRowsRef.current, [id]);
  }

  // One click fills the form with the 20 sample photos, their weights and dates, and the sample sales file.
  async function loadSample() {
    setPhotosOpen(true);
    setSales(null);
    setProblems([]);
    setTagging("");
    try {
      const parsed = parseStockCsv(await (await fetch("/sample/designs.csv")).text());
      if (!parsed.ok) throw new Error(parsed.error);
      const loaded = await Promise.all(
        parsed.rows.map(async (r) => {
          const file = new File([await (await fetch(`/sample/photos/${r.id}.jpg`)).blob()], `${r.id}.jpg`, { type: "image/jpeg" });
          const small = await shrink(file);
          if (!small) throw new Error(r.id);
          return {
            id: r.id,
            ...small,
            weight: String(r.weightGrams),
            qty: String(r.quantity),
            date: r.stockInDate,
            name: r.name || undefined,
            ornament: r.ornament || undefined,
            karigar: r.karigar || undefined,
            ornamentCategory: categoryForOrnament(r.ornament),
            status: "waiting",
          } as Item;
        }),
      );
      update(loaded);
      stockRowsRef.current = parsed.rows;
      setStockName("designs.csv (sample)");
      setStockNote(`Filled in ${loaded.length} of ${loaded.length} photos from the stock list.`);
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
    if (stockRowsRef.current.length) applyStock(stockRowsRef.current, added.map((i) => i.id));
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
        const base = data.results?.[item.id];
        const forced = itemsRef.current.find((i) => i.id === item.id)?.ornamentCategory;
        const tags = base && forced ? { ...base, category: forced } : base;
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
      name: r.name,
      ornament: r.ornament,
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
      {/* Sticky black header */}
      <header className="site-header">
        <nav className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6" aria-label="Main">
          <a href="#top" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-xl tracking-tight text-white">
              <b className="font-extrabold">Zevar</b>
              <b className="font-extrabold" style={{ color: "var(--gold)" }}>
                {" "}
                IQ
              </b>
            </span>
          </a>
          <div className="hidden items-center gap-7 text-sm font-semibold md:flex">
            <a href="#top">Home</a>
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
          </div>
          <a href="#try" className="btn btn-primary btn-sm">
            Try it free
          </a>
        </nav>
      </header>

      {/* Cream hero */}
      <section className="hero">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div>
            <h1 className="text-4xl font-bold leading-[1.12] sm:text-5xl lg:text-[3.6rem]">
              Track Your Purchases, Sales &amp; Inventory
              <span className="gold-text block">Find Gold Locked in Stock</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg" style={{ color: "var(--text)" }}>
              Add what you bought and what you sold. Zevar IQ&apos;s AI reads every design and shows what is stuck, what sells, and what to reorder from your karigars.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#try" className="btn btn-primary">
                Try Zevar IQ
              </a>
              <a href="#how" className="btn btn-ghost">
                <span aria-hidden="true">▷</span> See how it works
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold" style={{ color: "var(--muted)" }}>
              <li>
                <span style={{ color: "var(--gold)" }}>✓</span> Stuck-gold number in under a second
              </li>
              <li>
                <span style={{ color: "var(--gold)" }}>✓</span> AI reads every design photo
              </li>
              <li>
                <span style={{ color: "var(--gold)" }}>✓</span> Nothing is sent to karigars
              </li>
            </ul>
          </div>
          <HeroArt />
        </div>
      </section>

      {/* The three things being tracked */}
      <section id="features" className="scroll-mt-16 bg-white py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold sm:text-5xl">Control Your Stock From One Dashboard</h2>
            <p className="mt-4 text-lg" style={{ color: "var(--muted)" }}>
              Purchases, inventory and sales, tracked together, so you can see what your gold is doing.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              { icon: "bag", t: "Purchases", d: "Record each piece you stock in: its photo, weight, quantity and stock-in date." },
              { icon: "gem", t: "Inventory", d: "See every design with its age, idle days, and the grams of gold still on the shelf." },
              { icon: "chart", t: "Sales", d: "Match your sales file to designs and see what sells and what has not moved in 12 months." },
            ].map((f) => (
              <div key={f.t} className="card p-7">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: "var(--cream)", color: "var(--gold)" }}>
                  <Icon name={f.icon} />
                </span>
                <h3 className="mt-5 text-xl font-bold">{f.t}</h3>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  {f.d}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The working app */}
      <main className="flex-1" style={{ background: "var(--cream)" }}>
        <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <span className="chip chip-gold">Try it now</span>
            <h2 className="mt-4 text-3xl font-bold sm:text-5xl">Add Your Stock and Sales</h2>
            <p className="mt-3 text-lg" style={{ color: "var(--muted)" }}>
              Use your own photos and sales file, or load the sample data to see it work.
            </p>
          </div>

          {/* The working card */}
          <section id="try" className="card scroll-mt-20 p-5 sm:p-8">
            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <div className="flex items-center gap-3">
                  <span className="step-num">1</span>
                  <h3 className="text-lg font-bold">Stock photos (purchases)</h3>
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
                <div className="mt-5 rounded-xl p-4" style={{ background: "var(--cream)" }}>
                  <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>
                    Stock list (optional)
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    CSV with design_id, weight_grams, quantity, stock_in_date, and optionally design_name, ornament_type, purity and karigar. It fills in every photo at once.
                  </p>
                  <div className="mt-3">
                    <input type="file" accept=".csv,text/csv" onChange={(e) => onStockFile(e.target.files?.[0])} />
                  </div>
                  {stockName && (
                    <p className="mt-2 text-xs font-semibold" style={{ color: "var(--good)" }}>
                      ✓ {stockName}. {stockNote}
                    </p>
                  )}
                  <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                    Need demo files?{" "}
                    <a className="font-bold underline" href="/sample/designs.csv" download>
                      designs.csv
                    </a>
                    {" · "}
                    <a className="font-bold underline" href="/sample/sales.csv" download>
                      sales.csv
                    </a>
                    {" · "}
                    <a className="font-bold underline" href="/sample/zevar-demo-photos.zip" download>
                      20 demo photos (.zip)
                    </a>
                  </p>
                </div>
                {items.length > 0 && !csvName.includes("(sample)") && !stockName && (
                  <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                    {items.length} photos added. Set grams, quantity and stock-in date for each under &quot;Photos and details&quot; below.
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center gap-3">
                  <span className="step-num">2</span>
                  <h3 className="text-lg font-bold">Sales file</h3>
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
                  <p className="mt-3 text-xs font-semibold" style={{ color: "var(--good)" }}>
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
                      {i.name && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold" style={{ color: "var(--ink)" }}>
                            {i.name}
                          </span>
                          {i.ornament && <span className="chip chip-gold">{i.ornament}</span>}
                        </div>
                      )}
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
        </div>
      </main>

      {/* Black "why" section */}
      <section className="section-black py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold sm:text-5xl">Built for the Way Jewellers Work</h2>
            <p className="mt-4 text-lg" style={{ color: "rgba(255,255,255,0.7)" }}>
              Fast, simple and always under your control.
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: "bolt", t: "Stuck gold in a second", d: "Weights, dates and sales are added up instantly. You never wait on the AI for the headline number." },
              { icon: "eye", t: "AI that reads designs", d: "Each photo is tagged from a fixed list, and anything the AI is unsure about is flagged for you." },
              { icon: "check", t: "You stay in control", d: "Approve or edit every reorder. Nothing is ever sent to a karigar automatically." },
              { icon: "file", t: "Works with what you have", d: "Your own stock photos and a simple sales CSV. No special hardware or set-up." },
            ].map((w) => (
              <div key={w.t} className="rounded-2xl p-6" style={{ background: "#161616", border: "1px solid #2a2a2a" }}>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: "var(--gold)", color: "#1a1204" }}>
                  <Icon name={w.icon} />
                </span>
                <h3 className="mt-5 text-lg font-bold">{w.t}</h3>
                <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.68)" }}>
                  {w.d}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-16 bg-white py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold sm:text-5xl">From Photo to Reorder List in Three Steps</h2>
            <p className="mt-4 text-lg" style={{ color: "var(--muted)" }}>
              AI is used only where the input is fuzzy: reading a design from a photo, and explaining a pick. Everything else is plain arithmetic you can check.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              { n: "1", t: "AI reads each design", d: "Each photo is tagged with a category, style and price band from a fixed list, and anything uncertain is flagged for you." },
              { n: "2", t: "Plain maths finds stuck stock", d: "Your sales file is matched to designs. Anything unsold for 12 months with stock left is stuck, and its gold is added up." },
              { n: "3", t: "You decide what to reorder", d: "You get a reorder list and a do-not-reorder list with a reason for each. Approve or edit every item." },
            ].map((s) => (
              <div key={s.n} className="card p-7">
                <span className="step-num">{s.n}</span>
                <h3 className="mt-5 text-xl font-bold">{s.t}</h3>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  {s.d}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 py-16 sm:py-20" style={{ background: "var(--cream)" }}>
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-bold sm:text-5xl">Frequently Asked Questions</h2>
          <div className="mt-10 space-y-3">
            {[
              { q: "What files do I need?", a: "Photos of your designs, and a sales file (CSV) with three columns: design_id, date and amount. design_id must match the Design ID shown on each photo." },
              { q: "Is the AI always right?", a: "No. Each tag comes with a confidence score, and anything the AI is unsure about is highlighted for you to check or change. Nothing is hidden or corrected silently." },
              { q: "Does Zevar IQ contact my karigars?", a: "Never. It only shows lists. You approve or edit every item, and any ordering stays with you." },
              { q: "Where does my data go?", a: "Your photos and sales file stay in your browser while you work. Photos are sent to the AI service only to be read for their tags, and nothing is kept in a database." },
            ].map((f) => (
              <details key={f.q} className="card p-5">
                <summary>{f.q}</summary>
                <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Gold call-to-action band */}
      <section className="gold-band">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-12 sm:px-6">
          <div>
            <h2 className="text-2xl font-bold sm:text-3xl">Ready to see what is locking up your gold?</h2>
            <p className="mt-1 text-sm font-medium" style={{ opacity: 0.8 }}>
              Load the sample data and watch it work in seconds.
            </p>
          </div>
          <a href="#try" className="btn btn-dark">
            Try Zevar IQ
          </a>
        </div>
      </section>

      <footer style={{ background: "var(--navy-900)", color: "rgba(255,255,255,0.72)" }}>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-xs sm:px-6">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="text-sm font-bold text-white">
              Zevar <span style={{ color: "var(--gold)" }}>IQ</span>
            </span>
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
