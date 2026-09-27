"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import useAdminStatus from "@/components/useAdminStatus";
import { getLeagueFixtureDeadline } from "@/lib/league-deadline";
import { supabase } from "@/lib/supabase";

type CompetitionRow = {
  id: string;
  name: string;
  sport_type: string;
  competition_format: string;
  is_archived: boolean;
};

type MatchRow = {
  id: string;
  competition_id: string;
  player1_id: string | null;
  player2_id: string | null;
  scheduled_for: string | null;
  status: "pending" | "in_progress" | "complete" | "bye";
  round_no: number | null;
  match_no: number | null;
};

type PlayerRow = { id: string; display_name: string; full_name: string | null };
type RescheduleRow = {
  match_id: string;
  original_scheduled_for: string;
  requested_scheduled_for: string;
  reviewed_at: string | null;
  created_at: string;
};

type OutstandingFixture = {
  match: MatchRow;
  competition: CompetitionRow;
  playerOne: string;
  playerTwo: string;
  deadline: Date;
  reschedule: RescheduleRow | null;
  overdue: boolean;
};

function displayDate(value: string | null) {
  if (!value) return "Date not set";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function displayDeadline(value: Date) {
  return value.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OutstandingFixturesPage() {
  const admin = useAdminStatus();
  const canManage = admin.isAdmin || admin.isSuper;
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [reschedules, setReschedules] = useState<RescheduleRow[]>([]);
  const [submittedMatchIds, setSubmittedMatchIds] = useState<Set<string>>(new Set());
  const [competitionFilter, setCompetitionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "overdue" | "rescheduled">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (admin.loading || !canManage) return;
    let cancelled = false;
    const load = async () => {
      const client = supabase;
      if (!client) {
        setError("Supabase is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      const [competitionRes, matchRes, playerRes, rescheduleRes, submissionRes] = await Promise.all([
        client.from("competitions").select("id,name,sport_type,competition_format,is_archived").eq("competition_format", "league"),
        client.from("matches").select("id,competition_id,player1_id,player2_id,scheduled_for,status,round_no,match_no").eq("is_archived", false).in("status", ["pending", "in_progress"]),
        client.from("players").select("id,display_name,full_name").eq("is_archived", false),
        client.from("league_reschedule_requests").select("match_id,original_scheduled_for,requested_scheduled_for,reviewed_at,created_at").eq("status", "approved").order("created_at", { ascending: true }),
        client.from("result_submissions").select("match_id").eq("status", "pending"),
      ]);
      if (cancelled) return;
      const firstError = competitionRes.error || matchRes.error || playerRes.error || rescheduleRes.error || submissionRes.error;
      if (firstError) {
        setError(firstError.message || "Outstanding fixtures could not be loaded.");
      } else {
        setCompetitions((competitionRes.data ?? []) as CompetitionRow[]);
        setMatches((matchRes.data ?? []) as MatchRow[]);
        setPlayers((playerRes.data ?? []) as PlayerRow[]);
        setReschedules((rescheduleRes.data ?? []) as RescheduleRow[]);
        setSubmittedMatchIds(new Set((submissionRes.data ?? []).map((row) => String(row.match_id))));
        setError(null);
      }
      setLoading(false);
    };
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [admin.loading, canManage]);

  const competitionById = useMemo(() => new Map(competitions.map((competition) => [competition.id, competition])), [competitions]);
  const playerNameById = useMemo(() => new Map(players.map((player) => [player.id, player.full_name?.trim() || player.display_name])), [players]);
  const latestRescheduleByMatch = useMemo(() => {
    const map = new Map<string, RescheduleRow>();
    for (const request of reschedules) map.set(request.match_id, request);
    return map;
  }, [reschedules]);

  const outstanding = useMemo(() => {
    const now = new Date();
    return matches.flatMap((match): OutstandingFixture[] => {
      const competition = competitionById.get(match.competition_id);
      if (!competition || competition.is_archived || submittedMatchIds.has(match.id)) return [];
      if (!match.player1_id || !match.player2_id || match.player1_id === match.player2_id || !match.scheduled_for) return [];
      const deadline = getLeagueFixtureDeadline(match.scheduled_for, competition.name);
      if (!deadline) return [];
      const reschedule = latestRescheduleByMatch.get(match.id) ?? null;
      const overdue = deadline.getTime() < now.getTime();
      if (!overdue && !reschedule) return [];
      return [{
        match,
        competition,
        playerOne: playerNameById.get(match.player1_id) ?? "Unknown player",
        playerTwo: playerNameById.get(match.player2_id) ?? "Unknown player",
        deadline,
        reschedule,
        overdue,
      }];
    }).sort((a, b) => a.deadline.getTime() - b.deadline.getTime() || a.competition.name.localeCompare(b.competition.name));
  }, [competitionById, latestRescheduleByMatch, matches, playerNameById, submittedMatchIds]);

  const visibleFixtures = outstanding.filter((fixture) => {
    if (competitionFilter !== "all" && fixture.competition.id !== competitionFilter) return false;
    if (statusFilter === "overdue" && !fixture.overdue) return false;
    if (statusFilter === "rescheduled" && !fixture.reschedule) return false;
    return true;
  });
  const listedCompetitions = [...new Map(outstanding.map((fixture) => [fixture.competition.id, fixture.competition])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const overdueCount = outstanding.filter((fixture) => fixture.overdue).length;
  const rescheduledCount = outstanding.filter((fixture) => fixture.reschedule).length;

  return (
    <main className="min-h-screen bg-slate-100 p-3 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Outstanding Fixtures"
            eyebrow="Club Manager"
            subtitle="Delayed and rescheduled league fixtures that still need to be played. Fixtures with a submitted result awaiting review are excluded."
          />

          {!admin.loading && !canManage ? (
            <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">Club Manager access only.</section>
          ) : null}

          {canManage ? (
            <>
              <section className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Still to play</p><p className="mt-1 text-3xl font-black text-slate-950">{outstanding.length}</p></div>
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-rose-700">Past deadline</p><p className="mt-1 text-3xl font-black text-rose-950">{overdueCount}</p></div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Rescheduled</p><p className="mt-1 text-3xl font-black text-amber-950">{rescheduledCount}</p></div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">Competition
                    <select value={competitionFilter} onChange={(event) => setCompetitionFilter(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900">
                      <option value="all">All competitions</option>
                      {listedCompetitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-slate-700">Show
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900">
                      <option value="all">All outstanding</option>
                      <option value="overdue">Past deadline</option>
                      <option value="rescheduled">Rescheduled</option>
                    </select>
                  </label>
                </div>
              </section>

              {loading ? <section className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm">Loading outstanding fixtures…</section> : null}
              {error ? <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900">{error}</section> : null}
              {!loading && !error ? (
                <section className="space-y-3">
                  {visibleFixtures.map((fixture) => (
                    <article key={fixture.match.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${fixture.overdue ? "border-rose-200" : "border-amber-200"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            {fixture.overdue ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">Past deadline</span> : null}
                            {fixture.reschedule ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">Rescheduled</span> : null}
                            {fixture.match.status === "in_progress" ? <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800">In progress</span> : null}
                          </div>
                          <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-teal-700">{fixture.competition.name}</p>
                          <h2 className="mt-1 text-xl font-black text-slate-950">{fixture.playerOne} vs {fixture.playerTwo}</h2>
                          <p className="mt-1 text-sm text-slate-600">Week {fixture.match.round_no ?? "—"} · Match {fixture.match.match_no ?? "—"} · Week beginning {displayDate(fixture.match.scheduled_for)}</p>
                          <p className={`mt-2 text-sm font-semibold ${fixture.overdue ? "text-rose-800" : "text-slate-700"}`}>Current deadline: {displayDeadline(fixture.deadline)}</p>
                          {fixture.reschedule ? <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">Moved from the week beginning <strong>{displayDate(fixture.reschedule.original_scheduled_for)}</strong> to <strong>{displayDate(fixture.reschedule.requested_scheduled_for)}</strong>.</p> : null}
                        </div>
                        <Link href={`/matches/${fixture.match.id}`} className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-800">Open fixture</Link>
                      </div>
                    </article>
                  ))}
                  {!visibleFixtures.length ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">No fixtures match this filter.</div> : null}
                </section>
              ) : null}
            </>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
