"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import MessageModal from "@/components/MessageModal";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";

type Competition = {
  id: string;
  name: string;
  venue: string | null;
  sport_type: "snooker" | "pool_8_ball" | "pool_9_ball";
  competition_format: "knockout" | "league";
  match_mode: "singles" | "doubles";
  signup_open: boolean;
  signup_deadline: string | null;
  max_entries: number | null;
  created_at: string;
};

type Entry = {
  id: string;
  competition_id: string;
  requester_user_id: string;
  player_id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  created_at: string;
};

type AppUser = { id: string; linked_player_id: string | null };
type Player = { id: string; display_name: string; full_name: string | null };

const sportLabel: Record<Competition["sport_type"], string> = {
  snooker: "Snooker",
  pool_8_ball: "Pool (8-ball)",
  pool_9_ball: "Pool (9-ball)",
};

export default function CompetitionSignupPage() {
  const admin = useAdminStatus();
  const [message, setMessage] = useState<string | null>(null);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [linkedPlayerId, setLinkedPlayerId] = useState<string | null>(null);
  const [busyCompetitionId, setBusyCompetitionId] = useState<string | null>(null);

  const playerNameById = useMemo(
    () => new Map(players.map((p) => [p.id, p.full_name?.trim() ? p.full_name : p.display_name])),
    [players]
  );

  const myEntriesByCompetitionId = useMemo(() => {
    const map = new Map<string, Entry>();
    if (!userId) return map;
    for (const entry of entries) {
      if (entry.requester_user_id !== userId) continue;
      map.set(entry.competition_id, entry);
    }
    return map;
  }, [entries, userId]);

  const activeEntryCountByCompetitionId = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      if (entry.status !== "approved" && entry.status !== "pending") continue;
      map.set(entry.competition_id, (map.get(entry.competition_id) ?? 0) + 1);
    }
    return map;
  }, [entries]);

  const load = async () => {
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }

    const authRes = await client.auth.getUser();
    const uid = authRes.data.user?.id ?? null;
    setUserId(uid);
    if (!uid) return;

    const [competitionRes, entryRes, appUserRes, playerRes] = await Promise.all([
      client
        .from("competitions")
        .select("id,name,venue,sport_type,competition_format,match_mode,signup_open,signup_deadline,max_entries,created_at")
        .eq("signup_open", true)
        .eq("is_archived", false)
        .eq("is_completed", false)
        .order("created_at", { ascending: false }),
      client
        .from("competition_entries")
        .select("id,competition_id,requester_user_id,player_id,status,created_at")
        .order("created_at", { ascending: false }),
      client.from("app_users").select("id,linked_player_id").eq("id", uid).maybeSingle(),
      client.from("players").select("id,display_name,full_name").eq("is_archived", false),
    ]);

    const firstError =
      competitionRes.error?.message || entryRes.error?.message || appUserRes.error?.message || playerRes.error?.message || null;
    if (firstError) {
      setMessage(firstError);
      return;
    }

    setCompetitions((competitionRes.data ?? []) as Competition[]);
    setEntries((entryRes.data ?? []) as Entry[]);
    setLinkedPlayerId(((appUserRes.data as AppUser | null)?.linked_player_id ?? null) as string | null);
    setPlayers((playerRes.data ?? []) as Player[]);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const enter = async (competition: Competition) => {
    const client = supabase;
    if (!client || !userId) return;
    if (!linkedPlayerId) {
      setMessage("Link your player profile before entering a competition.");
      return;
    }
    if (!competition.signup_open) {
      setMessage("Sign-ups are closed for this competition.");
      return;
    }
    if (competition.signup_deadline && new Date(competition.signup_deadline).getTime() < Date.now()) {
      setMessage("The sign-up deadline has passed for this competition.");
      return;
    }
    if (competition.max_entries && (activeEntryCountByCompetitionId.get(competition.id) ?? 0) >= competition.max_entries) {
      setMessage("This competition is currently full.");
      return;
    }

    const existing = myEntriesByCompetitionId.get(competition.id) ?? null;
    setBusyCompetitionId(competition.id);

    if (existing && (existing.status === "approved" || existing.status === "pending")) {
      setBusyCompetitionId(null);
      setMessage("You are already signed up for this competition.");
      return;
    }

    if (existing) {
      const { error } = await client
        .from("competition_entries")
        .update({ status: "pending", player_id: linkedPlayerId })
        .eq("id", existing.id);
      setBusyCompetitionId(null);
      if (error) {
        setMessage(error.message);
        return;
      }
    } else {
      const { error } = await client.from("competition_entries").insert({
        competition_id: competition.id,
        requester_user_id: userId,
        player_id: linkedPlayerId,
        status: "pending",
      });
      setBusyCompetitionId(null);
      if (error) {
        setMessage(error.message);
        return;
      }
    }

    await load();
  };

  const withdraw = async (competitionId: string) => {
    const client = supabase;
    if (!client || !userId) return;
    const existing = myEntriesByCompetitionId.get(competitionId) ?? null;
    if (!existing || (existing.status !== "approved" && existing.status !== "pending")) return;

    setBusyCompetitionId(competitionId);
    const { error } = await client.from("competition_entries").update({ status: "withdrawn" }).eq("id", existing.id);
    setBusyCompetitionId(null);
    if (error) {
      setMessage(error.message);
      return;
    }
    await load();
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Competition Sign-ups"
            eyebrow="Competitions"
            subtitle="Enter competitions when sign-ups are open and track your current entry status."
          />
          <MessageModal message={message} onClose={() => setMessage(null)} />

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-600">
              Choose an open competition and submit your entry. Competition entries are queued as pending until approved by a Club Admin or the Super User.
            </p>
          </section>

          <section className="space-y-3">
            {competitions.map((competition) => {
              const myEntry = myEntriesByCompetitionId.get(competition.id) ?? null;
              const currentEntries = activeEntryCountByCompetitionId.get(competition.id) ?? 0;
              const isFull = Boolean(competition.max_entries && currentEntries >= competition.max_entries);
              const deadlinePassed = Boolean(
                competition.signup_deadline && new Date(competition.signup_deadline).getTime() < Date.now()
              );

              return (
                <div key={competition.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{competition.name}</p>
                      <p className="text-sm text-slate-600">
                        {sportLabel[competition.sport_type]} · {competition.competition_format} · {competition.match_mode}
                        {competition.venue ? ` · ${competition.venue}` : ""}
                      </p>
                      <p className="text-xs text-slate-500">
                        Entries: {currentEntries}
                        {competition.max_entries ? ` / ${competition.max_entries}` : ""}
                      </p>
                      {competition.signup_deadline ? (
                        <p className="text-xs text-slate-500">
                          Deadline: {new Date(competition.signup_deadline).toLocaleString()}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full border border-teal-300 bg-teal-100 px-2 py-0.5 text-teal-900">
                        Sign-ups open
                      </span>
                      {myEntry ? (
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-700">
                          Your status: {myEntry.status}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {myEntry && (myEntry.status === "pending" || myEntry.status === "approved") ? (
                      <button
                        type="button"
                        onClick={() => void withdraw(competition.id)}
                        disabled={busyCompetitionId === competition.id}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyCompetitionId === competition.id ? "Updating..." : "Withdraw"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void enter(competition)}
                        disabled={busyCompetitionId === competition.id || deadlinePassed || isFull}
                        className="rounded-lg bg-fuchsia-700 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busyCompetitionId === competition.id ? "Submitting..." : "Enter competition"}
                      </button>
                    )}

                    {deadlinePassed ? <span className="text-xs text-slate-500">The deadline has passed.</span> : null}
                    {!deadlinePassed && isFull ? <span className="text-xs text-slate-500">This competition is full.</span> : null}
                  </div>

                  {admin.isAdmin || admin.isSuper ? (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-800">Current entries</p>
                      <div className="mt-1 space-y-1 text-sm text-slate-700">
                        {entries
                          .filter((entry) => entry.competition_id === competition.id && (entry.status === "pending" || entry.status === "approved"))
                          .map((entry) => (
                            <div key={entry.id}>
                              {(playerNameById.get(entry.player_id) ?? entry.player_id)} · {entry.status}
                            </div>
                          ))}
                        {entries.filter((entry) => entry.competition_id === competition.id && (entry.status === "pending" || entry.status === "approved")).length === 0 ? (
                          <p className="text-xs text-slate-500">No entries yet.</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {competitions.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600 shadow-sm">
                No competitions are currently open for sign-up.
              </div>
            ) : null}
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
