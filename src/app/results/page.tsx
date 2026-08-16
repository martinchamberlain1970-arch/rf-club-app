"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";
import ScreenHeader from "@/components/ScreenHeader";
import MessageModal from "@/components/MessageModal";

type Submission = {
  id: string;
  match_id: string;
  submitted_by_user_id: string | null;
  competition_entry_id: string | null;
  submitted_at: string;
  team1_score: number;
  team2_score: number;
  break_and_run: boolean;
  run_out_against_break: boolean;
  break_and_run_team1?: number | null;
  break_and_run_team2?: number | null;
  run_out_against_break_team1?: number | null;
  run_out_against_break_team2?: number | null;
  status: "pending" | "approved" | "rejected";
};

type MatchRow = {
  id: string;
  competition_id: string;
  match_mode: "singles" | "doubles";
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
};

type CompetitionRow = {
  id: string;
  name: string;
  location_id?: string | null;
};

type Player = { id: string; display_name: string; full_name?: string | null };
type EntryLink = { id: string; player_id: string };
type DeadlineFixture = {
  id: string;
  competitionName: string;
  week: number;
  scheduledFor: string | null;
  deadline: string | null;
  player1: string;
  player2: string;
  bestOf: number;
  submissionCount: number;
  decision: "no_submission" | "single_submission" | "agreed" | "dispute";
  submissions: Array<{ id: string; team1Score: number; team2Score: number; submittedAt: string }>;
};

function getRoleSummary(isSuper: boolean, isAdmin: boolean) {
  if (isSuper) {
    return {
      label: "Super User",
      description: "Review escalated score submissions and monitor club-level result activity.",
      accent: "from-amber-50 via-white to-teal-50",
      badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  if (isAdmin) {
    return {
      label: "Club Admin",
      description: "Approve submitted results for your club and track what has already been reviewed.",
      accent: "from-sky-50 via-white to-emerald-50",
      badgeClass: "border-sky-200 bg-sky-50 text-sky-800",
    };
  }
  return {
    label: "Player",
    description: "Track the scores you have submitted and see whether they are pending, approved, or rejected.",
    accent: "from-indigo-50 via-white to-teal-50",
    badgeClass: "border-indigo-200 bg-indigo-50 text-indigo-800",
  };
}

function getStatusMeta(status: Submission["status"]) {
  switch (status) {
    case "approved":
      return {
        label: "Approved",
        pillClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "rejected":
      return {
        label: "Rejected",
        pillClass: "border-rose-200 bg-rose-50 text-rose-700",
      };
    case "pending":
    default:
      return {
        label: "Pending",
        pillClass: "border-amber-200 bg-amber-50 text-amber-700",
      };
  }
}

export default function ResultsQueuePage() {
  const admin = useAdminStatus();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [entryLinks, setEntryLinks] = useState<EntryLink[]>([]);
  const [deadlineFixtures, setDeadlineFixtures] = useState<DeadlineFixture[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);

  const load = async () => {
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    if (!admin.loading && !admin.isAdmin && !admin.userId) return;
    const authRes = await client.auth.getUser();
    const signedInUserId = authRes.data.user?.id ?? null;
    let currentAdminLocationId: string | null = null;
    if (admin.isAdmin && !admin.isSuper && signedInUserId) {
      const { data: appUser } = await client.from("app_users").select("linked_player_id").eq("id", signedInUserId).maybeSingle();
      if (appUser?.linked_player_id) {
        const { data: linkedPlayer } = await client.from("players").select("location_id").eq("id", appUser.linked_player_id).maybeSingle();
        currentAdminLocationId = (linkedPlayer?.location_id as string | null) ?? null;
      }
    }

    const submissionsQuery = client
      .from("result_submissions")
      .select("id,match_id,submitted_by_user_id,competition_entry_id,submitted_at,team1_score,team2_score,break_and_run,run_out_against_break,break_and_run_team1,break_and_run_team2,run_out_against_break_team1,run_out_against_break_team2,status")
      .order("submitted_at", { ascending: false });
    if (!admin.isAdmin && admin.userId) {
      submissionsQuery.eq("submitted_by_user_id", admin.userId);
    }
    const sRes = await submissionsQuery;
    if (sRes.error) {
      setMessage(sRes.error?.message || "Failed to load queue.");
      return;
    }
    let submissionRows = (sRes.data ?? []) as Submission[];

    if (!submissionRows.length) {
      setMatches([]);
      setCompetitions([]);
      setPlayers([]);
      setEntryLinks([]);
      return;
    }

    const matchIds = Array.from(new Set(submissionRows.map((s) => s.match_id)));
    const mRes = await client
      .from("matches")
      .select("id,competition_id,match_mode,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id")
      .in("id", matchIds);
    if (mRes.error) {
      setMessage(mRes.error?.message || "Failed to load match data.");
      return;
    }
    const matchRows = (mRes.data ?? []) as MatchRow[];
    setMatches(matchRows);

    const competitionIds = Array.from(new Set(matchRows.map((m) => m.competition_id)));
    const cRes = competitionIds.length
      ? await client.from("competitions").select("id,name,location_id").in("id", competitionIds)
      : { data: [] as CompetitionRow[] };
    if ("error" in cRes && cRes.error) {
      setMessage(cRes.error?.message || "Failed to load competition data.");
      return;
    }
    const competitionRows = ("data" in cRes ? cRes.data : []) as CompetitionRow[];
    setCompetitions(competitionRows);

    if (admin.isAdmin && !admin.isSuper) {
      const competitionById = new Map(competitionRows.map((c) => [c.id, c]));
      const matchById = new Map(matchRows.map((m) => [m.id, m]));
      submissionRows = submissionRows.filter((s) => {
        const m = matchById.get(s.match_id);
        if (!m) return false;
        const c = competitionById.get(m.competition_id);
        if (!c) return false;
        return Boolean(currentAdminLocationId && c.location_id === currentAdminLocationId);
      });
    }
    setSubmissions(submissionRows);

    const playerIds = Array.from(
      new Set(
        matchRows.flatMap((m) =>
          [
            m.player1_id,
            m.player2_id,
            m.team1_player1_id,
            m.team1_player2_id,
            m.team2_player1_id,
            m.team2_player2_id,
          ].filter(Boolean)
        ) as string[]
      )
    );
    const pRes = playerIds.length
      ? await client.from("players").select("id,display_name,full_name").in("id", playerIds)
      : { data: [] as Player[] };
    if ("error" in pRes && pRes.error) {
      setMessage(pRes.error?.message || "Failed to load player data.");
      return;
    }
    setPlayers(("data" in pRes ? pRes.data : []) as Player[]);
    const competitionEntryIds = [...new Set(submissionRows.map((submission) => submission.competition_entry_id).filter(Boolean) as string[])];
    const entryResult = competitionEntryIds.length
      ? await client.from("competition_entries").select("id,player_id").in("id", competitionEntryIds)
      : { data: [] as EntryLink[] };
    if ("error" in entryResult && entryResult.error) {
      setMessage(entryResult.error.message || "Failed to identify result submitters.");
      return;
    }
    setEntryLinks(("data" in entryResult ? entryResult.data : []) as EntryLink[]);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [admin.loading, admin.isAdmin, admin.isSuper, admin.userId]);

  useEffect(() => {
    if (!admin.isSuper) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      const client = supabase;
      const sessionResult = client ? await client.auth.getSession() : null;
      const accessToken = sessionResult?.data.session?.access_token;
      if (!accessToken) return;
      const response = await fetch("/api/admin/league-deadline-review", { headers: { Authorization: `Bearer ${accessToken}` } });
      const payload = await response.json().catch(() => ({}));
      if (!active) return;
      if (!response.ok) {
        setMessage(payload.error || "Deadline decisions could not be loaded.");
        return;
      }
      setDeadlineFixtures((payload.fixtures ?? []) as DeadlineFixture[]);
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [admin.isSuper]);

  const nameMap = useMemo(() => new Map(players.map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])), [players]);
  const compMap = useMemo(() => new Map(competitions.map((c) => [c.id, c.name])), [competitions]);
  const matchMap = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const entryPlayerMap = useMemo(() => new Map(entryLinks.map((entry) => [entry.id, entry.player_id])), [entryLinks]);

  const isEscalated = (submittedAt: string) => nowMs - Date.parse(submittedAt) > 72 * 60 * 60 * 1000;
  const pending = submissions.filter((s) => s.status === "pending");
  const pendingByMatch = new Map<string, Submission[]>();
  pending.forEach((submission) => pendingByMatch.set(submission.match_id, [...(pendingByMatch.get(submission.match_id) ?? []), submission]));
  const disputedMatchIds = new Set([...pendingByMatch.entries()].filter(([, rows]) => {
    const entrantIds = new Set(rows.map((row) => row.competition_entry_id).filter(Boolean));
    const scores = new Set(rows.map((row) => `${row.team1_score}-${row.team2_score}`));
    return entrantIds.size >= 2 && scores.size >= 2;
  }).map(([matchId]) => matchId));
  const normalPending = pending.filter((submission) => !disputedMatchIds.has(submission.match_id));
  const actionablePending = admin.isSuper ? normalPending : normalPending.filter((s) => !isEscalated(s.submitted_at));
  const escalatedPending = normalPending.filter((s) => isEscalated(s.submitted_at));
  const reviewed = submissions.filter((s) => s.status !== "pending");
  const roleSummary = getRoleSummary(admin.isSuper, admin.isAdmin);
  const cardClass = "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm";
  const itemClass = "rounded-2xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm";

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Results" eyebrow="Results" subtitle="Review submitted scores and track approval status." />
          <section className={`rounded-3xl border border-slate-200 bg-gradient-to-r ${roleSummary.accent} p-5 shadow-sm`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${roleSummary.badgeClass}`}>
                  {roleSummary.label}
                </span>
                <p className="max-w-2xl text-sm text-slate-700">{roleSummary.description}</p>
              </div>
              <div className={`grid min-w-[220px] flex-1 gap-3 ${admin.isAdmin ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {!admin.loading && !admin.isAdmin ? "Submitted" : "Awaiting review"}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {!admin.loading && !admin.isAdmin ? submissions.length : actionablePending.length}
                  </p>
                </div>
                {admin.isAdmin ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-700">Disputes</p>
                    <p className="mt-1 text-2xl font-semibold text-red-900">{disputedMatchIds.size}</p>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {!admin.loading && !admin.isAdmin ? "Pending" : "Escalated"}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    {!admin.loading && !admin.isAdmin ? pending.length : escalatedPending.length}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Reviewed</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{reviewed.length}</p>
                </div>
              </div>
            </div>
          </section>
          {!admin.loading && !admin.isAdmin ? (
            <section className={cardClass}>
              <h2 className="text-xl font-semibold text-slate-900">My submitted scores</h2>
              <MessageModal message={message} onClose={() => setMessage(null)} />
              <div className="mt-4 space-y-3">
                {submissions.length === 0 ? <p className="text-sm text-slate-600">You have not submitted any scores yet.</p> : null}
                {submissions.map((s) => {
                  const m = matchMap.get(s.match_id);
                  const title = m ? compMap.get(m.competition_id) ?? "Competition" : "Competition";
                  const p1 =
                    m?.match_mode === "doubles"
                      ? `${nameMap.get(m.team1_player1_id ?? "") ?? "TBC"} & ${nameMap.get(m.team1_player2_id ?? "") ?? "TBC"}`
                      : `${nameMap.get(m?.player1_id ?? "") ?? "TBC"}`;
                  const p2 =
                    m?.match_mode === "doubles"
                      ? `${nameMap.get(m.team2_player1_id ?? "") ?? "TBC"} & ${nameMap.get(m.team2_player2_id ?? "") ?? "TBC"}`
                      : `${nameMap.get(m?.player2_id ?? "") ?? "TBC"}`;
                  return (
                    <div key={s.id} className={itemClass}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <p className="text-sm text-slate-600">{title}</p>
                          <p className="text-xl font-semibold text-slate-900">{p1} vs {p2}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-900">
                              Score {s.team1_score} - {s.team2_score}
                            </span>
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusMeta(
                                s.status
                              ).pillClass}`}
                            >
                              {getStatusMeta(s.status).label}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                          {new Date(s.submitted_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <>
              <MessageModal message={message} onClose={() => setMessage(null)} />
              {admin.isSuper && deadlineFixtures.length ? (
                <section className="rounded-3xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
                  <h2 className="text-xl font-semibold text-amber-950">Monday deadline decisions ({deadlineFixtures.length})</h2>
                  <p className="mt-1 text-sm text-amber-900">These fixtures passed Sunday at 9pm without an approved result. You can accept a sole submission without chasing the opponent, enter the result yourself, award a genuine no-show result or walkover using that competition&apos;s format, or void the fixture.</p>
                  <div className="mt-4 space-y-3">
                    {deadlineFixtures.map((fixture) => {
                      const label = fixture.decision === "single_submission"
                        ? "One player submitted — accept or override"
                        : fixture.decision === "no_submission"
                          ? "No result submitted — award or void"
                          : fixture.decision === "dispute"
                            ? "Different scores submitted — decide result"
                            : "Both players agree — approve result";
                      return (
                        <article key={fixture.id} className="rounded-2xl border border-amber-200 bg-white p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">{fixture.competitionName} · Week {fixture.week}</p>
                          <p className="mt-1 text-lg font-semibold text-slate-950">{fixture.player1} vs {fixture.player2}</p>
                          <p className="mt-2 text-sm font-medium text-amber-900">{label}</p>
                          {fixture.submissions.length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {fixture.submissions.map((submission) => <span key={submission.id} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-semibold">{fixture.player1} {submission.team1Score}–{submission.team2Score} {fixture.player2}</span>)}
                            </div>
                          ) : null}
                          <Link href={`/matches/${fixture.id}`} className="mt-3 inline-flex rounded-xl bg-amber-800 px-4 py-2 text-sm font-semibold text-white">Review and decide</Link>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              {disputedMatchIds.size ? (
                <section className="rounded-3xl border-2 border-red-300 bg-red-50 p-5 shadow-sm">
                  <h2 className="text-xl font-semibold text-red-950">Disputes ({disputedMatchIds.size})</h2>
                  <p className="mt-1 text-sm text-red-800">Both players submitted different scores. Review the evidence and approve the correct submission; the other will be rejected automatically.</p>
                  <div className="mt-4 space-y-3">
                    {[...disputedMatchIds].map((matchId) => {
                      const match = matchMap.get(matchId);
                      const title = match ? compMap.get(match.competition_id) ?? "Competition" : "Competition";
                      const p1 = nameMap.get(match?.player1_id ?? "") ?? "TBC";
                      const p2 = nameMap.get(match?.player2_id ?? "") ?? "TBC";
                      return (
                        <div key={matchId} className="rounded-2xl border border-red-200 bg-white p-4">
                          <p className="text-sm text-slate-600">{title}</p>
                          <p className="mt-1 text-lg font-semibold text-slate-950">{p1} vs {p2}</p>
                          <div className="mt-3 space-y-2">
                            {(pendingByMatch.get(matchId) ?? []).map((submission) => (
                              <p key={submission.id} className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
                                <strong>{nameMap.get(entryPlayerMap.get(submission.competition_entry_id ?? "") ?? "") ?? "Player"}</strong> submitted {p1} {submission.team1_score}–{submission.team2_score} {p2}
                              </p>
                            ))}
                          </div>
                          <Link href={`/matches/${matchId}`} className="mt-3 inline-flex rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white">Review dispute</Link>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              <section className={cardClass}>
                <h2 className="text-xl font-semibold text-slate-900">Awaiting review ({actionablePending.length})</h2>
                {admin.isAdmin && !admin.isSuper && escalatedPending.length > 0 ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {escalatedPending.length} result request(s) are older than 72 hours and have been escalated to the Super User.
                  </p>
                ) : null}
                <div className="mt-4 space-y-3">
                  {actionablePending.length === 0 ? <p className="text-sm text-slate-600">No submitted scores are waiting for review.</p> : null}
                  {actionablePending.map((s) => {
                    const m = matchMap.get(s.match_id);
                    const title = m ? compMap.get(m.competition_id) ?? "Competition" : "Competition";
                    const p1 =
                      m?.match_mode === "doubles"
                        ? `${nameMap.get(m.team1_player1_id ?? "") ?? "TBC"} & ${nameMap.get(m.team1_player2_id ?? "") ?? "TBC"}`
                        : `${nameMap.get(m?.player1_id ?? "") ?? "TBC"}`;
                    const p2 =
                      m?.match_mode === "doubles"
                        ? `${nameMap.get(m.team2_player1_id ?? "") ?? "TBC"} & ${nameMap.get(m.team2_player2_id ?? "") ?? "TBC"}`
                        : `${nameMap.get(m?.player2_id ?? "") ?? "TBC"}`;
                    return (
                      <div key={s.id} className={itemClass}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-[220px] flex-1 space-y-2">
                            <p className="text-sm text-slate-600">{title}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-xl font-semibold text-slate-900">{p1} vs {p2}</p>
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusMeta(
                                  s.status
                                ).pillClass}`}
                              >
                                {getStatusMeta(s.status).label}
                              </span>
                              {isEscalated(s.submitted_at) ? (
                                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                                  Escalated
                                </span>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-900">
                                Score {s.team1_score} - {s.team2_score}
                              </span>
                            </div>
                            <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                              <p className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                Break &amp; Run: {p1} {s.break_and_run_team1 ?? 0} · {p2} {s.break_and_run_team2 ?? 0}
                              </p>
                              <p className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                Run Out: {p1} {s.run_out_against_break_team1 ?? 0} · {p2} {s.run_out_against_break_team2 ?? 0}
                              </p>
                            </div>
                          </div>
                          <div className="flex min-w-[170px] flex-col items-start gap-3">
                            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                              {new Date(s.submitted_at).toLocaleString()}
                            </p>
                            <Link
                              href={`/matches/${s.match_id}`}
                              className="inline-flex rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700 transition hover:border-teal-300 hover:bg-teal-100"
                            >
                              Open match review
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={cardClass}>
                <h2 className="text-xl font-semibold text-slate-900">Review history</h2>
                <div className="mt-4 space-y-3">
                  {reviewed.length === 0 ? <p className="text-sm text-slate-600">No reviewed score submissions yet.</p> : null}
                  {reviewed.map((s) => {
                    const m = matchMap.get(s.match_id);
                    const p1 =
                      m?.match_mode === "doubles"
                        ? `${nameMap.get(m.team1_player1_id ?? "") ?? "TBC"} & ${nameMap.get(m.team1_player2_id ?? "") ?? "TBC"}`
                        : `${nameMap.get(m?.player1_id ?? "") ?? "TBC"}`;
                    const p2 =
                      m?.match_mode === "doubles"
                        ? `${nameMap.get(m.team2_player1_id ?? "") ?? "TBC"} & ${nameMap.get(m.team2_player2_id ?? "") ?? "TBC"}`
                        : `${nameMap.get(m?.player2_id ?? "") ?? "TBC"}`;
                    return (
                      <div key={s.id} className={`${itemClass} text-sm text-slate-700`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusMeta(
                                  s.status
                                ).pillClass}`}
                              >
                                {getStatusMeta(s.status).label}
                              </span>
                              <span className="text-sm text-slate-600">{p1} vs {p2}</span>
                            </div>
                            <p className="text-sm font-medium text-slate-900">
                              Score {s.team1_score}-{s.team2_score}
                            </p>
                          </div>
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                            {new Date(s.submitted_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </RequireAuth>
      </div>
    </main>
  );
}
