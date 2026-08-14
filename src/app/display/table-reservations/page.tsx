"use client";

import { useEffect, useMemo, useState } from "react";

type Table = { id: string; name: string; sport_type: "pool" | "snooker"; display_order: number };
type Reservation = { id: string; table_id: string; starts_at: string; ends_at: string; purpose: string; notes: string | null; playerName: string };
type DisplayData = { tables: Table[]; reservations: Reservation[]; updatedAt: string };

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
    const groups = new Map<string, Reservation[]>();
    for (const reservation of data?.reservations ?? []) {
      const key = new Date(reservation.starts_at).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
      groups.set(key, [...(groups.get(key) ?? []), reservation]);
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
        {data && !grouped.length ? <div className="rounded-3xl border border-emerald-600/40 bg-white/5 p-12 text-center"><p className="text-4xl font-black">No upcoming reservations</p><p className="mt-3 text-2xl text-emerald-200">Tables are currently unreserved.</p></div> : null}
        <div className="grid gap-5 lg:grid-cols-2">
          {grouped.map(([date, reservations]) => <section key={date} className="rounded-3xl border border-emerald-500/40 bg-black/40 p-6 shadow-2xl"><h2 className="text-3xl font-black text-lime-300">{day(reservations[0].starts_at)}</h2><div className="mt-4 space-y-3">{reservations.map((reservation) => <article key={reservation.id} className="grid grid-cols-[150px_1fr_auto] items-center gap-5 rounded-2xl bg-white p-5 text-slate-950"><p className="text-2xl font-black">{time(reservation.starts_at)}–{time(reservation.ends_at)}</p><div><p className="text-2xl font-black">{reservation.playerName}</p><p className="text-lg text-slate-600">{reservation.purpose.replace("_", " ")}{reservation.notes ? ` · ${reservation.notes}` : ""}</p></div><span className="rounded-full bg-emerald-100 px-4 py-2 text-lg font-bold text-emerald-900">{tableNames.get(reservation.table_id) || "Table"}</span></article>)}</div></section>)}
        </div>
        {data ? <p className="text-right text-sm text-emerald-200">Updated {new Date(data.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/London" })}</p> : null}
      </div>
    </main>
  );
}
