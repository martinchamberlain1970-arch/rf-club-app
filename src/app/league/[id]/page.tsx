"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type Fixture = { id: string; week: number; matchNo: number; bestOf: number; status: string; scheduledFor: string | null; player1: string; player2: string; score: { player1: number; player2: number; void: boolean } | null };
type TableRow = { playerId: string; playerName: string; played: number; won: number; lost: number; voided: number; points: number };
type LeagueData = { competition: { id: string; name: string; venue: string | null; sport_type: string; league_schedule_mode: string | null; league_finals_size: number | null }; fixtures: Fixture[]; table: TableRow[]; updatedAt: string };

const displayDate = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : null;

export default function PublicLeaguePage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<LeagueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedWeek, setSelectedWeek] = useState("current");

  useEffect(() => {
    fetch(`/api/public/leagues/${encodeURIComponent(params.id)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "League could not be loaded.");
        setData(payload as LeagueData);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "League could not be loaded."));
  }, [params.id]);

  const weeks = useMemo(() => [...new Set((data?.fixtures ?? []).map((fixture) => fixture.week))].sort((a, b) => a - b), [data]);
  const currentWeek = useMemo(() => {
    if (!data?.fixtures.length) return weeks[0] ?? 1;
    const unfinished = data.fixtures.find((fixture) => !["complete", "bye"].includes(fixture.status));
    return unfinished?.week ?? weeks.at(-1) ?? 1;
  }, [data, weeks]);
  const visibleFixtures = useMemo(() => {
    if (!data) return [];
    const week = selectedWeek === "current" ? currentWeek : Number(selectedWeek);
    return data.fixtures.filter((fixture) => fixture.week === week);
  }, [data, selectedWeek, currentWeek]);

  if (error) return <main className="min-h-screen bg-slate-950 p-5 text-white"><div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 text-slate-900">{error}</div></main>;
  if (!data) return <main className="min-h-screen bg-slate-950 p-5 text-white"><p className="mx-auto max-w-3xl">Loading league…</p></main>;
  const isMasters = data.competition.name.trim().toLowerCase() === "greenhithe legion masters 2026";
  const unit = data.competition.sport_type === "snooker" ? "frames" : "racks";

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-emerald-950 to-slate-950 px-4 py-6 text-white">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="rounded-3xl border border-lime-500/40 bg-black/60 p-6 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-lime-300">Public league centre</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">{data.competition.name}</h1>
          <p className="mt-2 text-sm text-slate-300">{data.competition.venue || "Greenhithe Legion Social Club"} · Every {unit.slice(0, -1)} counts</p>
          <nav className="mt-5 flex flex-wrap gap-2">
            <a href="#fixtures" className="rounded-full bg-lime-400 px-4 py-2 text-sm font-bold text-slate-950">Weekly fixtures</a>
            <a href="#table" className="rounded-full border border-lime-400 px-4 py-2 text-sm font-bold text-lime-200">League table</a>
          </nav>
        </header>

        <section id="fixtures" className="scroll-mt-4 rounded-3xl bg-white p-5 text-slate-950 shadow-xl">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Fixtures & results</p><h2 className="mt-1 text-2xl font-black">Weekly fixture list</h2></div>
            <label className="text-sm font-semibold text-slate-700">Show week
              <select value={selectedWeek} onChange={(event) => setSelectedWeek(event.target.value)} className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2">
                <option value="current">Current (Week {currentWeek})</option>
                {weeks.map((week) => <option key={week} value={week}>Week {week}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4 space-y-3">
            {visibleFixtures.map((fixture) => (
              <article key={fixture.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500"><span>Week {fixture.week} · Match {fixture.matchNo}</span><span>{displayDate(fixture.scheduledFor)}</span></div>
                <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
                  <p className="font-bold">{fixture.player1}</p>
                  <div className="min-w-20 rounded-xl bg-slate-900 px-3 py-2 font-black text-white">{fixture.score ? (fixture.score.void ? "VOID" : `${fixture.score.player1} – ${fixture.score.player2}`) : "v"}</div>
                  <p className="font-bold">{fixture.player2}</p>
                </div>
                <p className="mt-2 text-center text-xs text-slate-500">Best of {fixture.bestOf} {unit} · {fixture.status.replace("_", " ")}</p>
              </article>
            ))}
            {!visibleFixtures.length ? <p className="text-sm text-slate-600">No fixtures have been published for this week.</p> : null}
          </div>
        </section>

        <section id="table" className="scroll-mt-4 rounded-3xl bg-white p-5 text-slate-950 shadow-xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Live standings</p>
          <h2 className="mt-1 text-2xl font-black">League table</h2>
          {isMasters ? <p className="mt-2 rounded-xl border border-lime-300 bg-lime-50 px-3 py-2 text-sm text-emerald-950"><strong>Top 8 highlighted:</strong> current Legion Masters Cup qualification places.</p> : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="border-b-2 border-slate-900 text-left"><th className="p-2">Pos</th><th className="p-2">Player</th><th className="p-2 text-center">P</th><th className="p-2 text-center">W</th><th className="p-2 text-center">L</th><th className="p-2 text-center">Void</th><th className="p-2 text-center">Pts</th></tr></thead>
              <tbody>{data.table.map((row, index) => {
                const qualifying = isMasters && index < 8;
                return <tr key={row.playerId} className={`border-b border-slate-200 ${qualifying ? "bg-lime-50" : ""}`}><td className="p-2 font-black">{index + 1}{qualifying ? <span className="ml-1 text-lime-700">★</span> : null}</td><td className="p-2 font-semibold">{row.playerName}</td><td className="p-2 text-center">{row.played}</td><td className="p-2 text-center">{row.won}</td><td className="p-2 text-center">{row.lost}</td><td className="p-2 text-center">{row.voided}</td><td className="p-2 text-center text-lg font-black">{row.points}</td></tr>;
              })}</tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">Updated {new Date(data.updatedAt).toLocaleString("en-GB")} · Refresh this page for the latest approved results.</p>
        </section>
      </div>
    </main>
  );
}
