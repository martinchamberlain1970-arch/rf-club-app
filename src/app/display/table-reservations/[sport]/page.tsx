"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import CueTableWeekGrid, {
  type GridAvailability,
  type GridBlock,
  type GridReservation,
  type GridTable,
} from "@/components/CueTableWeekGrid";

type DisplayData = {
  sport: "pool" | "snooker";
  weekStart: string;
  nextWeekStart: string;
  tables: GridTable[];
  reservations: GridReservation[];
  blocks: GridBlock[];
  availability: GridAvailability[];
  updatedAt: string;
};

const weekLabel = (start: string) => {
  const first = new Date(`${start}T12:00:00Z`);
  const last = new Date(first);
  last.setUTCDate(last.getUTCDate() + 6);
  const format = (date: Date) => date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  });
  return `${format(first)} – ${format(last)}`;
};

export default function TableReservationsSportDisplayPage() {
  const params = useParams<{ sport: string }>();
  const sport = params.sport === "snooker" ? "snooker" : "pool";
  const [data, setData] = useState<DisplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const response = await fetch(`/api/public/table-reservations?sport=${sport}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!active) return;
      if (!response.ok) setError(payload.error || "Reservations could not be loaded.");
      else {
        setData(payload as DisplayData);
        setError(null);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [sport]);

  const table = data?.tables[0];
  const weeks = data ? [
    { title: "Current week", start: data.weekStart },
    { title: "Following week", start: data.nextWeekStart },
  ] : [];

  return <main className={`min-h-screen bg-gradient-to-br p-5 text-white ${sport === "snooker" ? "from-slate-950 via-red-950 to-black" : "from-slate-950 via-emerald-950 to-black"}`}>
    <div className="mx-auto max-w-[1800px] space-y-5">
      <header className="flex items-start justify-between gap-6 border-b border-white/25 pb-4">
        <div>
          <p className="text-base font-bold uppercase tracking-[0.28em] text-lime-300">Greenhithe Legion Social Club</p>
          <h1 className="mt-1 text-4xl font-black">{table?.name ?? `${sport === "pool" ? "Pool" : "Snooker"} Table`} Diary</h1>
          <p className="mt-1 text-lg text-white/75">Days down the left · times across the top · live from Rack &amp; Frame</p>
        </div>
        <button type="button" onClick={async () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()} className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold">{isFullscreen ? "Exit full screen" : "Full screen"}</button>
      </header>

      {error ? <div className="rounded-2xl bg-red-900 p-4 text-xl">{error}</div> : null}
      {!data ? <p className="text-2xl text-white/75">Loading table diary…</p> : null}
      {data && !table ? <p className="rounded-2xl bg-amber-900 p-4 text-xl">No active {sport} table has been configured.</p> : null}

      {table ? weeks.map((week) => <section key={week.start} className="space-y-3 rounded-3xl border border-white/20 bg-black/30 p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-2xl font-black text-lime-300">{week.title}</h2>
          <p className="text-sm font-semibold text-white/65">{weekLabel(week.start)}</p>
        </div>
        <CueTableWeekGrid
          table={table}
          weekStart={week.start}
          reservations={data?.reservations ?? []}
          blocks={data?.blocks ?? []}
          availability={data?.availability ?? []}
          tv
        />
      </section>) : null}

      {data ? <p className="text-right text-xs text-white/55">Automatically refreshes every 30 seconds · Updated {new Date(data.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/London" })}</p> : null}
    </div>
  </main>;
}
