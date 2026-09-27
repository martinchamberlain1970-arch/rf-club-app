"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PublicFixture = {
  competitionId: string;
  competitionName: string;
  sportType: string;
  playerOne: string;
  playerTwo: string;
  scheduledFor: string;
  deadline: string;
  week: number | null;
  matchNo: number | null;
  status: string;
  overdue: boolean;
  originalScheduledFor: string | null;
  rescheduledTo: string | null;
};

type PublicPayload = { fixtures: PublicFixture[]; updatedAt: string };

function displayDate(value: string | null) {
  if (!value) return "Date not set";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function displayDeadline(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PublicOutstandingFixturesPage() {
  const [payload, setPayload] = useState<PublicPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [competitionFilter, setCompetitionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "overdue" | "rescheduled">("all");

  useEffect(() => {
    fetch("/api/public/outstanding-fixtures", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Outstanding fixtures could not be loaded.");
        setPayload(body as PublicPayload);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Outstanding fixtures could not be loaded."));
  }, []);

  const competitions = useMemo(() => {
    const map = new Map<string, string>();
    for (const fixture of payload?.fixtures ?? []) map.set(fixture.competitionId, fixture.competitionName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [payload]);
  const visibleFixtures = (payload?.fixtures ?? []).filter((fixture) => {
    if (competitionFilter !== "all" && fixture.competitionId !== competitionFilter) return false;
    if (statusFilter === "overdue" && !fixture.overdue) return false;
    if (statusFilter === "rescheduled" && !fixture.rescheduledTo) return false;
    return true;
  });

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-emerald-950 to-slate-950 px-3 py-5 text-white sm:px-5">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="rounded-3xl border border-emerald-400/30 bg-black/50 p-5 shadow-2xl sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-300">Rack &amp; Frame · League update</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">Outstanding fixtures</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">Matches that have been rescheduled or remain unplayed after their original deadline.</p>
        </header>

        {payload ? (
          <section className="rounded-3xl bg-white p-4 text-slate-950 shadow-xl sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">Competition
                <select value={competitionFilter} onChange={(event) => setCompetitionFilter(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-950">
                  <option value="all">All competitions</option>
                  {competitions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700">Show
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-950">
                  <option value="all">All outstanding</option>
                  <option value="overdue">Past deadline</option>
                  <option value="rescheduled">Rescheduled</option>
                </select>
              </label>
            </div>
          </section>
        ) : null}

        {!payload && !error ? <section className="rounded-3xl bg-white p-5 text-slate-600 shadow-xl">Loading outstanding fixtures…</section> : null}
        {error ? <section className="rounded-3xl border border-rose-300 bg-rose-50 p-5 text-rose-950 shadow-xl">{error}</section> : null}

        {payload ? (
          <section className="space-y-3">
            {visibleFixtures.map((fixture) => (
              <article key={`${fixture.competitionId}-${fixture.week}-${fixture.matchNo}-${fixture.playerOne}-${fixture.playerTwo}`} className="rounded-3xl bg-white p-5 text-slate-950 shadow-xl">
                <div className="flex flex-wrap gap-2">
                  {fixture.overdue ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">Past deadline</span> : null}
                  {fixture.rescheduledTo ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">Rescheduled</span> : null}
                </div>
                <p className="mt-3 text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">{fixture.competitionName}</p>
                <h2 className="mt-1 text-xl font-black">{fixture.playerOne} vs {fixture.playerTwo}</h2>
                <p className="mt-1 text-sm text-slate-600">Week {fixture.week ?? "—"} · Match {fixture.matchNo ?? "—"}</p>
                {fixture.rescheduledTo ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">Moved from the week beginning <strong>{displayDate(fixture.originalScheduledFor)}</strong> to <strong>{displayDate(fixture.rescheduledTo)}</strong>.</p>
                ) : (
                  <p className="mt-3 text-sm text-slate-700">Week beginning {displayDate(fixture.scheduledFor)}</p>
                )}
                <p className={`mt-2 text-sm font-semibold ${fixture.overdue ? "text-rose-800" : "text-slate-700"}`}>Play by {displayDeadline(fixture.deadline)}</p>
                <Link href={`/league/${fixture.competitionId}`} className="mt-4 inline-flex rounded-xl border border-emerald-700 px-3 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-50">View all competition fixtures</Link>
              </article>
            ))}
            {!visibleFixtures.length ? <div className="rounded-3xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950 shadow-xl">No fixtures match this filter.</div> : null}
          </section>
        ) : null}

        {payload ? <p className="text-center text-xs text-slate-400">Updated {new Date(payload.updatedAt).toLocaleString("en-GB")} · Refresh for the latest information.</p> : null}
      </div>
    </main>
  );
}
