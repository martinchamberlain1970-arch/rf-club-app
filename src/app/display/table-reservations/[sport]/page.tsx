"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Table = { id: string; name: string; sport_type: "pool" | "snooker" };
type Reservation = { id: string; table_id: string; starts_at: string; ends_at: string; playerName: string; purpose?: string; notes?: string | null };
type BookingBlock = { id: string; table_id: string | null; starts_at: string; ends_at: string; category?: string; title: string; notes?: string | null };
type DisplayData = { sport: "pool" | "snooker"; weekStart: string; nextWeekStart: string; tables: Table[]; reservations: Reservation[]; blocks: BookingBlock[]; updatedAt: string };
type AgendaItem = { id: string; startsAt: string; endsAt: string; title: string; detail: string; kind: "booking" | "closure" };

const londonDateKey = (value: string) => new Date(value).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const moveDate = (date: string, days: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
const timeLabel = (value: string) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const weekLabel = (start: string) => {
  const first = new Date(`${start}T12:00:00Z`);
  const last = new Date(first); last.setUTCDate(last.getUTCDate() + 6);
  const format = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
  return `${format(first)} – ${format(last)}`;
};

function agendaForWeek(data: DisplayData, table: Table, start: string) {
  const end = moveDate(start, 7);
  const inWeek = (startsAt: string) => { const date = londonDateKey(startsAt); return date >= start && date < end; };
  const items: AgendaItem[] = [
    ...data.reservations.filter((entry) => entry.table_id === table.id && inWeek(entry.starts_at)).map((entry) => ({ id: `booking-${entry.id}`, startsAt: entry.starts_at, endsAt: entry.ends_at, title: entry.playerName, detail: entry.purpose?.replaceAll("_", " ") || "Confirmed booking", kind: "booking" as const })),
    ...data.blocks.filter((entry) => (!entry.table_id || entry.table_id === table.id) && inWeek(entry.starts_at)).map((entry) => ({ id: `closure-${entry.id}`, startsAt: entry.starts_at, endsAt: entry.ends_at, title: entry.title, detail: [entry.category?.replaceAll("_", " "), entry.notes].filter(Boolean).join(" · ") || "Unavailable", kind: "closure" as const })),
  ].sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
  return items.reduce<Array<{ date: string; items: AgendaItem[] }>>((groups, item) => {
    const date = londonDateKey(item.startsAt);
    const group = groups.find((entry) => entry.date === date);
    if (group) group.items.push(item);
    else groups.push({ date, items: [item] });
    return groups;
  }, []);
}

export default function TableReservationsSportDisplayPage() {
  const params = useParams<{ sport: string }>();
  const sport = params.sport === "snooker" ? "snooker" : "pool";
  const [data, setData] = useState<DisplayData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const response = await fetch(`/api/public/table-reservations?sport=${sport}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!active) return;
      if (!response.ok) setError(payload.error || "Bookings could not be loaded.");
      else { setData(payload as DisplayData); setError(null); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [sport]);

  const table = data?.tables[0];
  const weeks = data && table ? [
    { title: "Current week", start: data.weekStart, groups: agendaForWeek(data, table, data.weekStart) },
    { title: "Following week", start: data.nextWeekStart, groups: agendaForWeek(data, table, data.nextWeekStart) },
  ] : [];

  return <main className={`min-h-screen bg-gradient-to-br p-5 text-white ${sport === "snooker" ? "from-slate-950 via-red-950 to-black" : "from-slate-950 via-emerald-950 to-black"}`}>
    <div className="mx-auto max-w-[1800px] space-y-5">
      <header className="border-b border-white/25 pb-4"><p className="text-base font-bold uppercase tracking-[0.28em] text-lime-300">Greenhithe Legion Social Club</p><h1 className="mt-1 text-4xl font-black">{table?.name ?? `${sport === "pool" ? "Pool" : "Snooker"} Table`} Bookings</h1></header>
      {error ? <div className="rounded-2xl bg-red-900 p-4 text-xl">{error}</div> : null}
      {!data ? <p className="text-2xl text-white/75">Loading bookings…</p> : null}
      {data && !table ? <p className="rounded-2xl bg-amber-900 p-4 text-xl">No active {sport} table has been configured.</p> : null}

      <div className="grid gap-5 xl:grid-cols-2">{weeks.map((week) => <section key={week.start} className="rounded-3xl border border-white/20 bg-black/30 p-5 shadow-2xl"><div className="flex items-center justify-between gap-4 border-b border-white/15 pb-3"><h2 className="text-2xl font-black text-lime-300">{week.title}</h2><p className="text-sm font-semibold text-white/65">{weekLabel(week.start)}</p></div>
        {week.groups.length ? <div className="mt-4 space-y-4">{week.groups.map((group) => <div key={group.date}><h3 className="mb-2 text-lg font-black text-white">{dayLabel(group.date)}</h3><div className="space-y-2">{group.items.map((item) => <article key={item.id} className={`grid grid-cols-[115px_1fr] gap-3 rounded-2xl border px-4 py-3 ${item.kind === "closure" ? "border-amber-400/60 bg-amber-300 text-amber-950" : "border-sky-400/50 bg-sky-700 text-white"}`}><p className="text-lg font-black">{timeLabel(item.startsAt)}–{timeLabel(item.endsAt)}</p><div><p className="text-lg font-black">{item.title}</p><p className="text-sm capitalize opacity-80">{item.detail}</p></div></article>)}</div></div>)}</div> : <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-950/60 p-6 text-center"><p className="text-xl font-bold text-emerald-200">No bookings currently listed</p></div>}
      </section>)}</div>

      {data ? <p className="text-right text-xs text-white/55">Automatically refreshes every 30 seconds · Updated {new Date(data.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/London" })}</p> : null}
    </div>
  </main>;
}
