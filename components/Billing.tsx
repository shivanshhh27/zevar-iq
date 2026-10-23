"use client";

// Billing prototype: pick a design, enter the bill, save. Each saved bill is one sale that records its Design ID,
// so the analysis needs no sales file for these sales.

import { useState } from "react";
import { Bill, billProblem, GST_PERCENT, makeBill } from "@/lib/billing";

export type BillDesign = { id: string; name?: string; ornament?: string; weight: string; preview: string };

const today = () => new Date().toISOString().slice(0, 10);
const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

export default function Billing({ designs, bills, onAdd, onRemove }: { designs: BillDesign[]; bills: Bill[]; onAdd: (b: Bill) => void; onRemove: (i: number) => void }) {
  const [designId, setDesignId] = useState("");
  const [grams, setGrams] = useState("");
  const [rate, setRate] = useState("7500");
  const [making, setMaking] = useState("12");
  const [date, setDate] = useState(""); // blank means today, filled in when the bill is saved
  const [problem, setProblem] = useState("");

  const chosen = designs.find((d) => d.id === designId);
  const input = { designId, date: date || "2000-01-01", grams: Number(grams), rate: Number(rate), makingPercent: Number(making) };
  const preview = billProblem(input) ? null : makeBill(input);

  function pick(id: string) {
    setDesignId(id);
    setProblem("");
    const d = designs.find((x) => x.id === id);
    if (d) setGrams(d.weight);
  }

  function save() {
    const real = { ...input, date: date || today() };
    const p = billProblem(real);
    setProblem(p ?? "");
    if (p) return;
    onAdd(makeBill(real));
    setDesignId("");
    setGrams("");
  }

  return (
    <section className="card p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-bold">Billing (prototype)</h3>
        <span className="chip chip-gold">Each bill records its Design ID</span>
      </div>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        Make a bill here and the sale is recorded against the design automatically, so no sales file is needed for it. This is a demo, not a tax invoice: one GST rate of {GST_PERCENT}% on gold plus making charge, one piece per bill.
      </p>

      {designs.length === 0 ? (
        <p className="mt-4 text-sm font-semibold" style={{ color: "var(--muted)" }}>
          Add stock photos first, then you can bill them.
        </p>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-3 text-sm">
            <label className="block text-xs font-semibold" style={{ color: "var(--muted)" }}>
              Design
              <select className="input mt-1 w-full" value={designId} onChange={(e) => pick(e.target.value)}>
                <option value="">Pick a design…</option>
                {designs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.id}
                    {d.name ? ` · ${d.name}` : ""}
                    {d.ornament ? ` (${d.ornament})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold" style={{ color: "var(--muted)" }}>
                Weight (g)
                <input className="input mt-1 w-full" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
              </label>
              <label className="block text-xs font-semibold" style={{ color: "var(--muted)" }}>
                Gold rate (₹ per g, edit to today&apos;s rate)
                <input className="input mt-1 w-full" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              </label>
              <label className="block text-xs font-semibold" style={{ color: "var(--muted)" }}>
                Making charge (%)
                <input className="input mt-1 w-full" inputMode="decimal" value={making} onChange={(e) => setMaking(e.target.value)} />
              </label>
              <label className="block text-xs font-semibold" style={{ color: "var(--muted)" }}>
                Bill date (blank = today)
                <input className="input mt-1 w-full" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
          </div>

          <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--line)" }}>
            <div className="flex gap-3">
              {chosen && <img src={chosen.preview} alt={chosen.id} className="h-16 w-16 flex-none rounded-xl object-cover" />}
              <p className="font-bold" style={{ color: "var(--ink)" }}>
                {chosen ? `${chosen.id}${chosen.name ? " · " + chosen.name : ""}` : "No design picked"}
              </p>
            </div>
            <dl className="mt-3 space-y-1">
              {[
                ["Gold", preview?.gold],
                [`Making (${making || 0}%)`, preview?.making],
                [`GST (${GST_PERCENT}%)`, preview?.gst],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between">
                  <dt style={{ color: "var(--muted)" }}>{k}</dt>
                  <dd>{v === undefined ? "–" : inr(v as number)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t pt-2 text-base font-bold" style={{ borderColor: "var(--line)" }}>
                <dt>Total</dt>
                <dd>{preview ? inr(preview.total) : "–"}</dd>
              </div>
            </dl>
            <button className="btn btn-primary mt-4 w-full" onClick={save}>
              Save bill
            </button>
            {problem && <p className="alert alert-bad mt-3">{problem}</p>}
          </div>
        </div>
      )}

      {bills.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-bold">Bills made here ({bills.length})</h4>
          <ul className="mt-2 divide-y text-sm" style={{ borderColor: "var(--line)" }}>
            {bills.map((b, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <b>{b.designId}</b> · {b.grams} g · {b.date}
                </span>
                <span className="flex items-center gap-3">
                  <b>{inr(b.total)}</b>
                  <button className="text-xs font-bold underline" onClick={() => onRemove(i)}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            These count as sales in the analysis. They live in this browser tab only and are lost when you close it.
          </p>
        </div>
      )}
    </section>
  );
}
