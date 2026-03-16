"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import useAdminStatus from "@/components/useAdminStatus";
import MessageModal from "@/components/MessageModal";
import { supabase } from "@/lib/supabase";

type RescheduleRequest = {
  id: string;
  match_id: string;
  competition_id: string;
  requester_user_id: string;
  requester_player_id: string | null;
  original_scheduled_for: string;
  requested_scheduled_for: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  note: string | null;
  created_at: string;
};

type MatchRow = {
  id: string;
  player1_id: string | null;
  player2_id: string | null;
  scheduled_for: string | null;
  status: "pending" | "in_progress" | "complete" | "bye";
};

type CompetitionRow = { id: string; name: string };
type PlayerRow = { id: string; display_name: string; full_name: string | null };

export default function ReschedulesPage() {
  const admin = useAdminStatus();
  const [requests, setRequests] = useState<RescheduleRequest[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const client = supabase;
    if (!client) return;
    const [requestRes, matchRes, competitionRes, playerRes] = await Promise.all([
      client.from("league_reschedule_requests").select("*").order("created_at", { ascending: false }),
      client.from("matches").select("id,player1_id,player2_id,scheduled_for,status"),
      client.from("competitions").select("id,name"),
      client.from("players").select("id,display_name,full_name").eq("is_archived", false),
    ]);
    if (requestRes.error || matchRes.error || competitionRes.error || playerRes.error) {
      setMessage(
        requestRes.error?.message ||
          matchRes.error?.message ||
          competitionRes.error?.message ||
          playerRes.error?.message ||
          "Failed to load reschedule requests."
      );
      return;
    }
    setRequests((requestRes.data ?? []) as RescheduleRequest[]);
    setMatches((matchRes.data ?? []) as MatchRow[]);
    setCompetitions((competitionRes.data ?? []) as CompetitionRow[]);
    setPlayers((playerRes.data ?? []) as PlayerRow[]);
  };

  useEffect(() => {
    void load();
  }, []);

  const playerNameById = useMemo(
    () => new Map(players.map((player) => [player.id, player.full_name?.trim() ? player.full_name : player.display_name])),
    [players]
  );
  const competitionNameById = useMemo(() => new Map(competitions.map((competition) => [competition.id, competition.name])), [competitions]);
  const matchById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const pendingRequests = requests.filter((request) => request.status === "pending");
  const reviewedRequests = requests.filter((request) => request.status !== "pending");

  const reviewRequest = async (request: RescheduleRequest, nextStatus: "approved" | "rejected") => {
    const client = supabase;
    if (!client || !admin.isSuper || !admin.userId) return;
    setBusyId(request.id);
    if (nextStatus === "approved") {
      const wipeFrames = await client.from("frames").delete().eq("match_id", request.match_id);
      if (wipeFrames.error) {
        setBusyId(null);
        setMessage(wipeFrames.error.message);
        return;
      }
      const rejectSubmissions = await client
        .from("result_submissions")
        .update({
          status: "rejected",
          reviewed_by_user_id: admin.userId,
          reviewed_at: new Date().toISOString(),
          note: "Fixture rescheduled by Super User.",
        })
        .eq("match_id", request.match_id)
        .neq("status", "rejected");
      if (rejectSubmissions.error) {
        setBusyId(null);
        setMessage(rejectSubmissions.error.message);
        return;
      }
      const matchUpdate = await client
        .from("matches")
        .update({
          scheduled_for: request.requested_scheduled_for,
          status: "pending",
          winner_player_id: null,
        })
        .eq("id", request.match_id);
      if (matchUpdate.error) {
        setBusyId(null);
        setMessage(matchUpdate.error.message);
        return;
      }
    }

    const requestUpdate = await client
      .from("league_reschedule_requests")
      .update({
        status: nextStatus,
        reviewed_by_user_id: admin.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    setBusyId(null);
    if (requestUpdate.error) {
      setMessage(requestUpdate.error.message);
      return;
    }
    await load();
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Reschedule Requests"
            eyebrow="League Admin"
            subtitle="Super User review for one-week league fixture reschedule requests."
          />
          <MessageModal message={message} onClose={() => setMessage(null)} />

          {!admin.loading && !admin.isSuper ? (
            <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
              Super User access only.
            </section>
          ) : null}

          {admin.isSuper ? (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pending</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">{pendingRequests.length}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Reviewed</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">{reviewedRequests.length}</p>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                {pendingRequests.map((request) => {
                  const match = matchById.get(request.match_id);
                  const playerOne = match?.player1_id ? playerNameById.get(match.player1_id) ?? match.player1_id : "TBC";
                  const playerTwo = match?.player2_id ? playerNameById.get(match.player2_id) ?? match.player2_id : "TBC";
                  return (
                    <div key={request.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-lg font-semibold text-slate-900">{competitionNameById.get(request.competition_id) ?? "League competition"}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {playerOne} vs {playerTwo}
                      </p>
                      <p className="mt-2 text-sm text-slate-700">
                        Original week: {request.original_scheduled_for} · Requested week: {request.requested_scheduled_for}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Requested on {new Date(request.created_at).toLocaleString()}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link href={`/matches/${request.match_id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                          Open fixture
                        </Link>
                        <button
                          type="button"
                          disabled={busyId === request.id}
                          onClick={() => void reviewRequest(request, "approved")}
                          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                        >
                          Approve reschedule
                        </button>
                        <button
                          type="button"
                          disabled={busyId === request.id}
                          onClick={() => void reviewRequest(request, "rejected")}
                          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 disabled:opacity-60"
                        >
                          Reject request
                        </button>
                      </div>
                    </div>
                  );
                })}
                {!pendingRequests.length ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600 shadow-sm">
                    No reschedule requests are waiting for review.
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
