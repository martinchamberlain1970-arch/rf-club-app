"use client";

import { useEffect, useMemo, useState } from "react";

type Table = { id: string; name: string; sport_type: "pool" | "snooker"; display_order: number };
type Reservation = { id: string; table_id: string; starts_at: string; ends_at: string; purpose: string; notes: string | null; playerName: string };
type BookingBlock = { id: string; table_id: string | null; starts_at: string; ends_at: string; category: string; title: string; notes: string | null };
type DisplayData = { tables: Table[]; reservations: Reservation[]; blocks: BookingBlock[]; updatedAt: string };

const time = (value: string) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });

export default function TableReservationsDisplayPage() {
  const [data, setData] = useState<DisplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const response = await fetch("/api/public/table-reservations", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!active) return;
      if (!response.ok) setError(payload.error || "Reservations could not be loaded.");
      else { setData(payload as DisplayData); setError(null); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("fullscreenchange", onFullscreen); };
  }, []);

  const grouped = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; table_id: string | null; starts_at: string; ends_at: string; title: string; detail: string; blocked: boolean }>>();
    const entries = [
      ...(data?.reservations ?? []).map((reservation) => ({ id: reservation.id, table_id: reservation.table_id, starts_at: reservation.starts_at, ends_at: reservation.ends_at, title: reservation.playerName, detail: `${reservation.purpose.replace("_", " ")}${reservation.notes ? ` · ${reservation.notes}` : ""}`, blocked: false })),
      ...(data?.blocks ?? []).map((block) => ({ id: block.id, table_id: block.table_id, starts_at: block.starts_at, ends_at: block.ends_at, title: block.title, detail: `${block.category.replaceAll("_", " ")}${block.notes ? ` · ${block.notes}` : ""}`, blocked: true })),
    ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (const entry of entries) {
      const key = new Date(entry.starts_at).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.entries()].slice(0, 5);
  }, [data]);
  const tableNames = new Map((data?.tables ?? []).map((table) => [table.id, table.name]));

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-emerald-950 to-black p-7 text-white">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex items-start justify-between gap-6 border-b border-lime-400/50 pb-5">
          <div><p className="text-lg font-bold uppercase tracking-[0.28em] text-lime-300">Greenhithe Legion Social Club</p><h1 className="mt-2 text-5xl font-black">Cue Table Reservations</h1><p className="mt-2 text-xl text-emerald-100">Pool and snooker bookings · live from the Rack &amp; Frame app</p></div>
          <button type="button" onClick={async () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()} className="rounded-full border border-white/30 bg-white/10 px-5 py-3 text-lg font-semibold">{isFullscreen ? "Exit full screen" : "Full screen"}</button>
        </header>
        {error ? <div className="rounded-2xl bg-red-950 p-5 text-2xl">{error}</div> : null}
        {!data ? <p className="text-3xl text-emerald-100">Loading reservations…</p> : null}
        {data && !grouped.length ? <div className="rounded-3xl border border-emerald-600/40 bg-white/5 p-12 text-center"><p className="text-4xl font-black">No upcoming reservations</p><p className="mt-3 text-2xl text-emerald-200">No bookings or table closures are listed.</p></div> : null}
        <div className="grid gap-5 lg:grid-cols-2">
          {grouped.map(([date, entries]) => <section key={date} className="rounded-3xl border border-emerald-500/40 bg-black/40 p-6 shadow-2xl"><h2 className="text-3xl font-black text-lime-300">{day(entries[0].starts_at)}</h2><div className="mt-4 space-y-3">{entries.map((entry) => <article key={`${entry.blocked ? "block" : "booking"}-${entry.id}`} className={`grid grid-cols-[150px_1fr_auto] items-center gap-5 rounded-2xl p-5 text-slate-950 ${entry.blocked ? "bg-amber-100" : "bg-white"}`}><p className="text-2xl font-black">{time(entry.starts_at)}–{time(entry.ends_at)}</p><div><p className="text-2xl font-black">{entry.title}</p><p className="text-lg text-slate-600">{entry.detail}</p></div><span className={`rounded-full px-4 py-2 text-lg font-bold ${entry.blocked ? "bg-amber-700 text-white" : "bg-emerald-100 text-emerald-900"}`}>{entry.table_id ? tableNames.get(entry.table_id) || "Table" : "All tables"}</span></article>)}</div></section>)}
        </div>
        {data ? <p className="text-right text-sm text-emerald-200">Updated {new Date(data.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/London" })}</p> : null}
      </div>
    </main>
  );
}
