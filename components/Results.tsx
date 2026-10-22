"use client";
/* eslint-disable @next/next/no-img-element -- previews are in-memory data URLs, so next/image does not apply */

// Everything shown after "Analyze": banner, board, and the two lists.

import { useState } from "react";
import { Analysis, DesignRow, BoardGroup, STUCK_DAYS } from "@/lib/analysis";

export type Reasons = Record<string, string>;
type Placement = "reorder" | "do-not-reorder" | "removed";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const g = (n: number) => `${Math.round(n * 10) / 10} g`;

// Plain-text reason used when Claude's reason is missing.
export function basicReason(r: DesignRow): string {
  return r.stuck
    ? `No sale for ${r.idleDays} days; ${g(r.lockedGrams)} still in stock.`
    : `Sold ${r.sold} of ${r.quantity}; last sale ${r.lastSaleDate}.`;
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "red" | "green" | "amber" | "grey" }) {
  const colours = {
    red: "bg-red-100 text-red-800",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-900",
    grey: "bg-zinc-100 text-zinc-700",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${colours[tone]}`}>{children}</span>;
}

function GroupTable({ title, groups }: { title: string; groups: BoardGroup[] }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="py-1">Group</th>
            <th>Designs</th>
            <th>Sold / pieces</th>
            <th>Sell-through</th>
            <th>Avg age</th>
            <th>Stuck</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((x) => (
            <tr key={x.key} className="border-t">
              <td className="py-1">{x.key}</td>
              <td>{x.designs}</td>
              <td>
                {x.sold} / {x.pieces}
              </td>
              <td>{pct(x.sellThrough)}</td>
              <td>{x.avgAgeDays} days</td>
              <td>{x.stuckDesigns}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Results({
  analysis,
  thumbs,
  reasons,
  reasonsState,
  seconds,
}: {
  analysis: Analysis;
  thumbs: Record<string, string>;
  reasons: Reasons;
  reasonsState: "loading" | "ai" | "fallback";
  seconds: number;
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

  const renderItem = (r: DesignRow) => {
    const here = listOf(r);
    return (
      <li key={r.id} className="flex gap-3 border-t py-2">
        {thumbs[r.id] && <img src={thumbs[r.id]} alt={r.id} className="h-14 w-14 rounded object-cover" />}
        <div className="flex-1 text-sm">
          <div className="font-medium">
            {r.id} {r.tags && <span className="font-normal text-zinc-500">· {r.tags.category}, {r.tags.style}</span>}
            {approved[r.id] && <span className="ml-2"><Badge tone="green">Approved</Badge></span>}
          </div>
          <div>{reasons[r.id] ?? basicReason(r)}</div>
          <div className="text-xs text-zinc-500">
            Sold {r.sold} of {r.quantity} · idle {r.idleDays} days · {g(r.weightGrams)} each · {g(r.lockedGrams)} in stock
            {reasons[r.id] && " · reason written by Claude"}
          </div>
          <div className="mt-1 flex gap-2">
            <button className="rounded border px-2 py-0.5 text-xs" onClick={() => setApproved({ ...approved, [r.id]: !approved[r.id] })}>
              {approved[r.id] ? "Undo approve" : "Approve"}
            </button>
            <button
              className="rounded border px-2 py-0.5 text-xs"
              onClick={() => setPlacement({ ...placement, [r.id]: here === "reorder" ? "do-not-reorder" : "reorder" })}
            >
              Edit: move to {here === "reorder" ? "do-not-reorder" : "reorder"}
            </button>
            <button className="rounded border px-2 py-0.5 text-xs" onClick={() => setPlacement({ ...placement, [r.id]: "removed" })}>
              Edit: remove
            </button>
          </div>
        </div>
      </li>
    );
  };

  return (
    <section className="space-y-6">
      <div className="rounded-lg border-2 border-red-200 bg-red-50 p-4">
        <p className="text-lg font-semibold">
          {analysis.stuck.length} {analysis.stuck.length === 1 ? "design holds" : "designs hold"} {g(analysis.stuckGrams)} of gold and{" "}
          {analysis.stuck.length === 1 ? "hasn't" : "haven't"} sold in {Math.round(STUCK_DAYS / 30)} months.
        </p>
        <p className="text-sm text-zinc-600">
          Based only on the sales file you uploaded (up to {analysis.asOf}). Check the stock in your shop before acting. Finished in {seconds} {seconds === 1 ? "second" : "seconds"}.
        </p>
      </div>

      {analysis.unmatchedSaleIds.length > 0 && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
          These design_id values in the sales file match no photo, so they were ignored: {analysis.unmatchedSaleIds.join(", ")}.
        </p>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Sell-through and ageing board</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-1">Design</th>
              <th>Weight</th>
              <th>Sold / qty</th>
              <th>Age</th>
              <th>Idle</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {analysis.rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-1">{r.id}</td>
                <td>{g(r.weightGrams)}</td>
                <td>
                  {r.sold} / {r.quantity}
                </td>
                <td>{r.ageDays} d</td>
                <td>{r.idleDays} d</td>
                <td>{r.stuck ? <Badge tone="red">Stuck</Badge> : r.sellThrough >= 0.5 ? <Badge tone="green">Selling</Badge> : <Badge tone="grey">Slow</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-6 sm:grid-cols-2">
          <GroupTable title="By weight band" groups={analysis.byWeightBand} />
          <GroupTable title="By price band" groups={analysis.byPriceBand} />
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold">Reorder ({reorder.length})</h2>
          <ul>{reorder.map(renderItem)}</ul>
          {reorder.length === 0 && <p className="text-sm text-zinc-500">Nothing to reorder yet.</p>}
        </div>
        <div>
          <h2 className="text-lg font-semibold">Do not reorder ({dont.length})</h2>
          <ul>{dont.map(renderItem)}</ul>
          {dont.length === 0 && <p className="text-sm text-zinc-500">No stuck designs.</p>}
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        {reasonsState === "loading" && "Asking Claude for reasons… (basic reasons shown meanwhile)"}
        {reasonsState === "fallback" && "Claude's reasons were not available, so basic reasons are shown. "}
        Nothing here is sent to a karigar.
      </p>
    </section>
  );
}
