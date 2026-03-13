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
  submitted_by_user_id: string;
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

export default function ResultsQueuePage() {
  const admin = useAdminStatus();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
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
      .select("id,match_id,submitted_by_user_id,submitted_at,team1_score,team2_score,break_and_run,run_out_against_break,break_and_run_team1,break_and_run_team2,run_out_against_break_team1,run_out_against_break_team2,status")
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

  const nameMap = useMemo(() => new Map(players.map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])), [players]);
  const compMap = useMemo(() => new Map(competitions.map((c) => [c.id, c.name])), [competitions]);
  const matchMap = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);

  const isEscalated = (submittedAt: string) => nowMs - Date.parse(submittedAt) > 72 * 60 * 60 * 1000;
  const pending = submissions.filter((s) => s.status === "pending");
  const actionablePending = admin.isSuper ? pending : pending.filter((s) => !isEscalated(s.submitted_at));
  const escalatedPending = pending.filter((s) => isEscalated(s.submitted_at));
  const reviewed = submissions.filter((s) => s.status !== "pending");
  const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  const itemClass = "rounded-xl border border-slate-200 bg-white p-3";

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Results" eyebrow="Results" subtitle="Review submitted scores and track approval status." />
          {!admin.loading && !admin.isAdmin ? (
            <section className={cardClass}>
              <h2 className="text-xl font-semibold text-slate-900">My submitted scores</h2>
              <MessageModal message={message} onClose={() => setMessage(null)} />
              <div className="mt-3 space-y-2">
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
                      <p className="text-sm text-slate-600">{title}</p>
                      <p className="text-xl font-semibold text-slate-900">{p1} vs {p2}</p>
                      <p className="text-sm text-slate-700">Score: {s.team1_score} - {s.team2_score}</p>
                      <p className="text-xs text-slate-500">Status: {s.status.replace("_", " ")}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <>
              <MessageModal message={message} onClose={() => setMessage(null)} />
              <section className={cardClass}>
                <h2 className="text-xl font-semibold text-slate-900">Awaiting review ({actionablePending.length})</h2>
                {admin.isAdmin && !admin.isSuper && escalatedPending.length > 0 ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {escalatedPending.length} result request(s) are older than 72 hours and have been escalated to the Super User.
                  </p>
                ) : null}
                <div className="mt-3 space-y-2">
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
                        <p className="text-sm text-slate-600">{title}</p>
                        <p className="text-xl font-semibold text-slate-900">{p1} vs {p2}</p>
                        <p className="text-sm text-slate-700">Score: {s.team1_score} - {s.team2_score}</p>
                        {isEscalated(s.submitted_at) ? (
                          <p className="text-xs font-medium text-amber-700">Escalated to Super User</p>
                        ) : null}
                        <p className="text-xs text-slate-500">
                          Break &amp; Run: {p1} {s.break_and_run_team1 ?? 0} · {p2} {s.break_and_run_team2 ?? 0}
                        </p>
                        <p className="text-xs text-slate-500">
                          Run Out: {p1} {s.run_out_against_break_team1 ?? 0} · {p2} {s.run_out_against_break_team2 ?? 0}
                        </p>
                        <Link href={`/matches/${s.match_id}`} className="mt-2 inline-block text-sm font-medium text-teal-700 underline">
                          Open match review
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={cardClass}>
                <h2 className="text-xl font-semibold text-slate-900">Review history</h2>
                <div className="mt-3 space-y-2">
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
                        <span className="font-medium">{s.status.toUpperCase()}</span> · {p1} vs {p2} · {s.team1_score}-{s.team2_score}
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
