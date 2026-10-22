"use client";
/* eslint-disable @next/next/no-img-element -- previews are in-memory data URLs, so next/image does not apply */

// Everything shown after "Analyze": summary, the two lists, and the board.

import { useState } from "react";
import { Analysis, DesignRow, BoardGroup, STUCK_DAYS } from "@/lib/analysis";

export type Reasons = Record<string, string>;
type Placement = "reorder" | "do-not-reorder" | "removed";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const g = (n: number) => `${Math.round(n * 10) / 10} g`;

// Plain-text reason used when the AI's reason is missing.
export function basicReason(r: DesignRow): string {
  return r.stuck
    ? `No sale for ${r.idleDays} days; ${g(r.lockedGrams)} still in stock.`
    : `Sold ${r.sold} of ${r.quantity}; last sale ${r.lastSaleDate}.`;
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "bad" | "good" | "plain" }) {
  return (
    <span className={`chip ${tone === "bad" ? "chip-bad" : tone === "good" ? "chip-good" : ""}`} style={tone === "plain" ? { background: "#f1eee6", color: "#5d584c" } : undefined}>
      {children}
    </span>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "bad" | "good" | "gold" }) {
  const colour = tone === "bad" ? "var(--bad)" : tone === "good" ? "var(--good)" : tone === "gold" ? "#a87a24" : "var(--navy-900)";
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--line)", background: "#fffcf1" }}>
      <div className="text-3xl font-bold tracking-tight" style={{ color: colour }}>
        {value}
      </div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        {label}
      </div>
    </div>
  );
}

function GroupTable({ title, groups }: { title: string; groups: BoardGroup[] }) {
  return (
    <div className="card overflow-hidden">
      <h3 className="px-4 pt-4 pb-2 text-sm font-bold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Designs</th>
              <th>Sold / pieces</th>
              <th>Sell-through</th>
              <th>Avg age</th>
              <th>Stuck</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((x) => (
              <tr key={x.key}>
                <td className="font-semibold" style={{ color: "var(--ink)" }}>
                  {x.key}
                </td>
                <td>{x.designs}</td>
                <td>
                  {x.sold} / {x.pieces}
                </td>
                <td>{pct(x.sellThrough)}</td>
                <td>{x.avgAgeDays} days</td>
                <td>{x.stuckDesigns > 0 ? <Chip tone="bad">{x.stuckDesigns}</Chip> : x.stuckDesigns}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Results({
  analysis,
  thumbs,
  reasons,
  reasonsState,
  tagging,
  seconds,
  excludedIds,
}: {
  analysis: Analysis;
  thumbs: Record<string, string>;
  reasons: Reasons;
  reasonsState: "loading" | "ai" | "fallback";
  tagging: string; // e.g. "Tagging 7 of 20", or "" when all photos are done
  seconds: number; // how long tagging took (shown once it is done)
  excludedIds: string[]; // photos the AI said are not jewellery
}) {
  // What the owner has done to each list item. Nothing is sent anywhere.
  const [placement, setPlacement] = useState<Record<string, Placement>>({});
  const [approved, setApproved] = useState<Record<string, boolean>>({});

  const listOf = (r: DesignRow): Placement => placement[r.id] ?? (r.stuck ? "do-not-reorder" : "reorder");
  const reorderIds = new Set(analysis.reorder.map((r) => r.id));
  // Candidates for each list: the code's picks, plus anything the owner moved over.
  const candidates = analysis.rows.filter((r) => r.stuck || reorderIds.has(r.id) || placement[r.id]);
  const reorder = candidates.filter((r) => listOf(r) === "reorder");
  const dont = candidates.filter((r) => listOf(r) === "do-not-reorder");

  const noPhoto = analysis.unmatchedSaleIds.filter((id) => !excludedIds.includes(id));
  const notJewellery = analysis.unmatchedSaleIds.filter((id) => excludedIds.includes(id));

  const nothingStuck = analysis.stuck.length === 0;
  const selling = analysis.rows.filter((r) => !r.stuck && r.sellThrough >= 0.5).length;
  const months = Math.round(STUCK_DAYS / 30);

  const renderItem = (r: DesignRow) => {
    const here = listOf(r);
    return (
      <li key={r.id} className="flex gap-3 border-t py-3 first:border-t-0" style={{ borderColor: "var(--line)" }}>
        {thumbs[r.id] ? (
          <img src={thumbs[r.id]} alt={r.id} className="h-16 w-16 flex-none rounded-xl object-cover" style={{ boxShadow: "0 0 0 1px var(--line)" }} />
        ) : (
          <div className="h-16 w-16 flex-none rounded-xl" style={{ background: "var(--line)" }} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold" style={{ color: "var(--ink)" }}>
              {r.id}
              {r.name ? ` · ${r.name}` : ""}
            </span>
            {r.tags && (
              <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                · {r.ornament || r.tags.category}, {r.tags.style}
              </span>
            )}
            {approved[r.id] && <Chip tone="good">Approved</Chip>}
          </div>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text)" }}>
            {reasons[r.id] ?? basicReason(r)}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Sold {r.sold} of {r.quantity} · idle {r.idleDays} days · {g(r.weightGrams)} each · {g(r.lockedGrams)} in stock
            {reasons[r.id] && " · reason written by AI"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setApproved({ ...approved, [r.id]: !approved[r.id] })}>
              {approved[r.id] ? "Undo approve" : "Approve"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPlacement({ ...placement, [r.id]: here === "reorder" ? "do-not-reorder" : "reorder" })}
            >
              Edit: move to {here === "reorder" ? "do-not-reorder" : "reorder"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPlacement({ ...placement, [r.id]: "removed" })}>
              Edit: remove
            </button>
          </div>
        </div>
      </li>
    );
  };

  return (
    <section id="results" className="space-y-6 scroll-mt-6">
      {/* Summary */}
      <div className="card overflow-hidden">
        <div className="h-1.5" style={{ background: nothingStuck ? "var(--good)" : "linear-gradient(90deg, var(--bad), var(--brand))" }} />
        <div className="p-5 sm:p-7">
          <span className={`chip ${nothingStuck ? "chip-good" : "chip-bad"}`}>{nothingStuck ? "All clear" : "Gold is locked in unsold designs"}</span>
          <h2 className="mt-3 max-w-3xl text-xl font-bold leading-snug sm:text-2xl">
            {nothingStuck
              ? `No design has gone unsold for ${months} months, so no gold is stuck in this stock.`
              : `${analysis.stuck.length} ${analysis.stuck.length === 1 ? "design holds" : "designs hold"} ${g(analysis.stuckGrams)} of gold and ${analysis.stuck.length === 1 ? "hasn't" : "haven't"} sold in ${months} months.`}
          </h2>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            Based only on the sales file you uploaded (up to {analysis.asOf}). Check the stock in your shop before acting.{" "}
            {tagging ? `${tagging}… the board below fills in as photos are tagged.` : `Photos tagged in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Designs stuck" value={String(analysis.stuck.length)} tone={nothingStuck ? "good" : "bad"} />
            <Tile label="Gold locked" value={g(analysis.stuckGrams)} tone={nothingStuck ? "good" : "gold"} />
            <Tile label="Designs selling" value={String(selling)} tone="good" />
            <Tile label="Designs analysed" value={String(analysis.rows.length)} />
          </div>
        </div>
      </div>

      {noPhoto.length > 0 && (
        <p className="alert alert-warn">
          These design_id values in the sales file match none of your photos, so they were ignored: {noPhoto.join(", ")}.
        </p>
      )}
      {notJewellery.length > 0 && (
        <p className="alert alert-warn">Sales for {notJewellery.join(", ")} were ignored because the AI did not see jewellery in that photo.</p>
      )}

      {/* The two lists */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <div className="h-1.5" style={{ background: "var(--good)" }} />
          <div className="p-5">
            <h2 className="text-lg font-bold">Reorder ({reorder.length})</h2>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Selling well and not stuck. Best sellers first.
            </p>
            <ul className="mt-2">{reorder.map(renderItem)}</ul>
            {reorder.length === 0 && <p className="py-4 text-sm" style={{ color: "var(--muted)" }}>Nothing to reorder yet.</p>}
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="h-1.5" style={{ background: "var(--bad)" }} />
          <div className="p-5">
            <h2 className="text-lg font-bold">Do not reorder ({dont.length})</h2>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Unsold for {months} months or more, with stock still on the shelf. Heaviest first.
            </p>
            <ul className="mt-2">{dont.map(renderItem)}</ul>
            {dont.length === 0 && <p className="py-4 text-sm" style={{ color: "var(--muted)" }}>No stuck designs.</p>}
          </div>
        </div>
      </div>
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {reasonsState === "loading" && (tagging ? "Basic reasons shown; the AI writes better ones once all photos are tagged. " : "Asking the AI for reasons… (basic reasons shown meanwhile) ")}
        {reasonsState === "fallback" && "The AI's reasons were not available, so basic reasons are shown. "}
        Nothing here is sent to a karigar.
      </p>

      {/* The board */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold">Sell-through and ageing board</h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Design</th>
                  <th>Weight</th>
                  <th>Sold / qty</th>
                  <th>Age</th>
                  <th>Idle</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {analysis.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-bold" style={{ color: "var(--ink)" }}>
                      {r.id}
                      {r.name && (
                        <div className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                          {r.name}
                        </div>
                      )}
                    </td>
                    <td>{g(r.weightGrams)}</td>
                    <td>
                      {r.sold} / {r.quantity}
                    </td>
                    <td>{r.ageDays} d</td>
                    <td>{r.idleDays} d</td>
                    <td>{r.stuck ? <Chip tone="bad">Stuck</Chip> : r.sellThrough >= 0.5 ? <Chip tone="good">Selling</Chip> : <Chip tone="plain">Slow</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <GroupTable title="By weight band" groups={analysis.byWeightBand} />
          <GroupTable title="By price band" groups={analysis.byPriceBand} />
        </div>
      </div>
    </section>
  );
}
