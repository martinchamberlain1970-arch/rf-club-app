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
  handicap_enabled?: boolean;
  signup_open: boolean;
  signup_deadline: string | null;
  max_entries: number | null;
  entry_fee_pence: number | null;
  created_at: string;
};

type Entry = {
  id: string;
  competition_id: string;
  requester_user_id: string;
  player_id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  payment_status: "not_required" | "pending" | "paid" | "failed";
  payment_method: "stripe" | "cash" | null;
  payment_amount_pence: number | null;
  paid_at: string | null;
  created_at: string;
};

type AppUser = { id: string; linked_player_id: string | null };
type Player = { id: string; display_name: string; full_name: string | null };
type GuestEntry = {
  id: string;
  competition_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  status: "pending" | "added" | "rejected";
  payment_status: "not_required" | "pending" | "paid" | "failed";
  payment_method: "stripe" | "cash" | null;
  payment_amount_pence: number | null;
  paid_at: string | null;
  created_at: string;
  competitions: { name: string } | null;
  suggestions: Array<{ id: string; display_name: string; full_name: string | null; claimed_by: string | null; score: number }>;
};

const sportLabel: Record<Competition["sport_type"], string> = {
  snooker: "Snooker",
  pool_8_ball: "Pool (8-ball)",
  pool_9_ball: "Pool (9-ball)",
};

const paidDateTime = (value: string) => new Date(value).toLocaleString("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
});

export default function CompetitionSignupPage() {
  const admin = useAdminStatus();
  const [message, setMessage] = useState<string | null>(null);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [linkedPlayerId, setLinkedPlayerId] = useState<string | null>(null);
  const [busyCompetitionId, setBusyCompetitionId] = useState<string | null>(null);
  const [expandedCompetitionIds, setExpandedCompetitionIds] = useState<string[]>([]);
  const [guestEntries, setGuestEntries] = useState<GuestEntry[]>([]);
  const [guestActionId, setGuestActionId] = useState<string | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now());

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
        .select("id,name,venue,sport_type,competition_format,match_mode,handicap_enabled,signup_open,signup_deadline,max_entries,entry_fee_pence,created_at")
        .eq("signup_open", true)
        .eq("is_archived", false)
        .eq("is_completed", false)
        .order("created_at", { ascending: false }),
      client
        .from("competition_entries")
        .select("id,competition_id,requester_user_id,player_id,status,payment_status,payment_method,payment_amount_pence,paid_at,created_at")
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

    const sessionResult = await client.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;
    if (accessToken) {
      const guestResponse = await fetch("/api/admin/public-competition-signups", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (guestResponse.ok) {
        const guestData = await guestResponse.json();
        setGuestEntries((guestData.entries ?? []) as GuestEntry[]);
      }
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTimeMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const payment = new URLSearchParams(window.location.search).get("payment");
    if (payment === "success") setMessage("Payment received. Stripe is confirming your competition entry.");
    if (payment === "cancelled") setMessage("Payment was cancelled. Your entry is saved and you can try again.");
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
    if (competition.signup_deadline && new Date(competition.signup_deadline).getTime() < currentTimeMs) {
      setMessage("The sign-up deadline has passed for this competition.");
      return;
    }
    if (competition.max_entries && (activeEntryCountByCompetitionId.get(competition.id) ?? 0) >= competition.max_entries) {
      setMessage("This competition is currently full.");
      return;
    }

    const existing = myEntriesByCompetitionId.get(competition.id) ?? null;
    setBusyCompetitionId(competition.id);

    if (competition.entry_fee_pence && competition.entry_fee_pence > 0) {
      const sessionResult = await client.auth.getSession();
      const accessToken = sessionResult.data.session?.access_token;
      if (!accessToken) {
        setBusyCompetitionId(null);
        setMessage("Please sign in again.");
        return;
      }
      const response = await fetch(`/api/competitions/${competition.id}/signup/payment`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await response.json().catch(() => ({}));
      setBusyCompetitionId(null);
      if (!response.ok || typeof data.checkoutUrl !== "string") {
        setMessage(data.error ?? "Payment could not be started.");
        return;
      }
      window.location.assign(data.checkoutUrl);
      return;
    }

    if (existing && (existing.status === "approved" || existing.status === "pending")) {
      setBusyCompetitionId(null);
      setMessage("You are already signed up for this competition.");
      return;
    }

    const nextStatus: Entry["status"] = admin.isSuper ? "approved" : "pending";
    const approvalFields = admin.isSuper
      ? {
          reviewed_by_user_id: userId,
          reviewed_at: new Date().toISOString(),
        }
      : {
          reviewed_by_user_id: null,
          reviewed_at: null,
        };

    if (existing) {
      const { error } = await client
        .from("competition_entries")
        .update({ status: nextStatus, player_id: linkedPlayerId, ...approvalFields })
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
        status: nextStatus,
        ...approvalFields,
      });
      setBusyCompetitionId(null);
      if (error) {
        setMessage(error.message);
        return;
      }
    }

    if (admin.isSuper) {
      setMessage("Your Super User entry was approved automatically.");
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

  const addGuestEntry = async (entry: GuestEntry, options: { playerId?: string; createProfile?: boolean; ageBand?: "18_plus" | "under_18" }) => {
    const client = supabase;
    if (!client) return;
    const sessionResult = await client.auth.getSession();
    const accessToken = sessionResult.data.session?.access_token;
    if (!accessToken) {
      setMessage("Please sign in again.");
      return;
    }
    setGuestActionId(entry.id);
    const response = await fetch("/api/admin/public-competition-signups", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ signupId: entry.id, ...options }),
    });
    const data = await response.json().catch(() => ({}));
    setGuestActionId(null);
    if (!response.ok) {
      setMessage(data.error ?? "The guest could not be added.");
      return;
    }
    setGuestEntries((current) => current.map((item) => item.id === entry.id ? { ...item, status: "added" } : item));
    setMessage(`${entry.full_name} was added to the competition.${data.invitationSent ? " A Rack & Frame registration invitation was emailed to them." : data.invitationError ? ` The profile was added, but the invitation email failed: ${data.invitationError}` : ""}`);
    await load();
  };

  const toggleCompetitionField = (competitionId: string) => {
    setExpandedCompetitionIds((prev) =>
      prev.includes(competitionId) ? prev.filter((id) => id !== competitionId) : [...prev, competitionId]
    );
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
              Choose an open competition and submit your entry. Competition entries are normally queued as pending until approved by a Club Admin or the Super User.
              {admin.isSuper ? " Super User entries are approved automatically." : ""}
            </p>
          </section>

          {admin.isAdmin && guestEntries.length > 0 ? (
            <section className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-emerald-950">Public signup review</h2>
                  <p className="text-sm text-emerald-800">Entries received through public registration links.</p>
                </div>
                <span className="rounded-full bg-emerald-700 px-3 py-1 text-sm font-semibold text-white">
                  {guestEntries.filter((entry) => entry.status === "pending").length} pending
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {guestEntries.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-emerald-200 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{entry.full_name}</p>
                        <p className="text-sm text-slate-600">{entry.competitions?.name ?? "Competition"}</p>
                        <p className={`mt-1 text-sm font-medium ${entry.payment_status === "paid" ? "text-emerald-700" : "text-amber-700"}`}>
                          {entry.payment_status === "paid"
                            ? `Paid${entry.payment_method === "cash" ? " cash" : entry.payment_method === "stripe" ? " by Stripe" : ""}${entry.payment_amount_pence ? ` £${(entry.payment_amount_pence / 100).toFixed(2)}` : ""}${entry.paid_at ? ` · ${paidDateTime(entry.paid_at)}` : ""}`
                            : entry.payment_status === "failed" ? "Payment failed" : "Payment pending"}
                        </p>
                        {entry.note ? <p className="mt-1 text-sm text-slate-600">Note: {entry.note}</p> : null}
                        {entry.status === "pending" && entry.suggestions.length > 0 ? (
                          <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Possible existing profiles</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {entry.suggestions.map((player) => (
                                <button
                                  key={player.id}
                                  type="button"
                                  disabled={guestActionId === entry.id}
                                  onClick={() => void addGuestEntry(entry, { playerId: player.id })}
                                  className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-left text-sm text-indigo-950 disabled:opacity-50"
                                >
                                  Link and add: {player.full_name?.trim() || player.display_name}{player.claimed_by ? " · app account" : ""}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {entry.status === "pending" ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={guestActionId === entry.id}
                              onClick={() => void addGuestEntry(entry, { createProfile: true, ageBand: "18_plus" })}
                              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                              {guestActionId === entry.id ? "Adding…" : "Create adult profile and add"}
                            </button>
                            <button
                              type="button"
                              disabled={guestActionId === entry.id}
                              onClick={() => void addGuestEntry(entry, { createProfile: true, ageBand: "under_18" })}
                              className="rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
                            >
                              Create junior profile and add
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700">{entry.status}</span>
                        <a href={`/competitions/${entry.competition_id}`} className="rounded-lg border border-emerald-700 bg-white px-3 py-2 text-sm font-medium text-emerald-800">Competition</a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="space-y-3">
            {competitions.map((competition) => {
              const myEntry = myEntriesByCompetitionId.get(competition.id) ?? null;
              const currentEntries = activeEntryCountByCompetitionId.get(competition.id) ?? 0;
              const visibleEntries = entries.filter(
                (entry) => entry.competition_id === competition.id && (entry.status === "pending" || entry.status === "approved")
              );
              const approvedCount = visibleEntries.filter((entry) => entry.status === "approved").length;
              const pendingCount = visibleEntries.filter((entry) => entry.status === "pending").length;
              const isFull = Boolean(competition.max_entries && currentEntries >= competition.max_entries);
              const deadlinePassed = Boolean(
                competition.signup_deadline && new Date(competition.signup_deadline).getTime() < currentTimeMs
              );
              const fieldExpanded = expandedCompetitionIds.includes(competition.id);

              return (
                <div key={competition.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{competition.name}</p>
                      <p className="text-sm text-slate-600">
                        {sportLabel[competition.sport_type]} · {competition.competition_format} · {competition.match_mode}
                        {competition.handicap_enabled ? " · handicapped" : ""}
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
                      <p className="mt-1 text-xs font-semibold text-slate-700">
                        {competition.entry_fee_pence ? `Entry fee: £${(competition.entry_fee_pence / 100).toFixed(2)}` : "Free entry"}
                      </p>
                      {competition.competition_format === "league" ? (
                        <p className="mt-1 text-xs text-slate-600">
                          Weekly fixtures are expected to be completed by 21:00 on Sunday. Unresolved fixtures then go to the Super User, who can accept a sole submission, award a genuine no-show, or void the fixture.
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full border border-teal-300 bg-teal-100 px-2 py-0.5 text-teal-900">
                        Sign-ups open
                      </span>
                      {myEntry ? (
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-700">
                          Your status: {myEntry.status === "approved" && admin.isSuper ? "approved automatically" : myEntry.status}
                        </span>
                      ) : null}
                      {myEntry && competition.entry_fee_pence ? (
                        <span className={`rounded-full border px-2 py-0.5 ${myEntry.payment_status === "paid" ? "border-emerald-300 bg-emerald-100 text-emerald-900" : "border-amber-300 bg-amber-100 text-amber-900"}`}>
                          {myEntry.payment_status === "paid"
                            ? `Paid${myEntry.payment_method === "cash" ? " cash" : myEntry.payment_method === "stripe" ? " by Stripe" : ""} £${((myEntry.payment_amount_pence ?? competition.entry_fee_pence) / 100).toFixed(2)}${myEntry.paid_at ? ` · ${paidDateTime(myEntry.paid_at)}` : ""}`
                            : myEntry.payment_status === "failed" ? "Payment failed" : "Payment pending"}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {myEntry && competition.entry_fee_pence && myEntry.payment_status !== "paid" ? (
                      <button
                        type="button"
                        onClick={() => void enter(competition)}
                        disabled={busyCompetitionId === competition.id}
                        className="rounded-lg bg-fuchsia-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {busyCompetitionId === competition.id ? "Opening Stripe…" : `Pay £${(competition.entry_fee_pence / 100).toFixed(2)} entry fee`}
                      </button>
                    ) : null}
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
                        {busyCompetitionId === competition.id
                          ? competition.entry_fee_pence ? "Opening Stripe…" : "Submitting..."
                          : competition.entry_fee_pence ? `Enter and pay £${(competition.entry_fee_pence / 100).toFixed(2)}` : "Enter competition"}
                      </button>
                    )}

                    {deadlinePassed ? <span className="text-xs text-slate-500">The deadline has passed.</span> : null}
                    {!deadlinePassed && isFull ? <span className="text-xs text-slate-500">This competition is full.</span> : null}
                  </div>

                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Current field</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Approved: {approvedCount} · Pending: {pendingCount}
                          {competition.max_entries ? ` · Capacity: ${currentEntries}/${competition.max_entries}` : ` · Current entries: ${currentEntries}`}
                        </p>
                      </div>
                      {isFull ? (
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-800">
                          Field full
                        </span>
                      ) : competition.max_entries ? (
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-800">
                          {competition.max_entries - currentEntries} place{competition.max_entries - currentEntries === 1 ? "" : "s"} left
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => toggleCompetitionField(competition.id)}
                        className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                      >
                        {fieldExpanded ? "Hide field" : `Show field${visibleEntries.length ? ` (${visibleEntries.length})` : ""}`}
                      </button>
                    </div>
                    {fieldExpanded ? (
                      visibleEntries.length ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {visibleEntries.map((entry) => (
                            <div key={entry.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                              <span className="font-medium text-slate-900">{playerNameById.get(entry.player_id) ?? entry.player_id}</span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                  entry.status === "approved"
                                    ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : "border border-amber-200 bg-amber-50 text-amber-900"
                                }`}
                              >
                                {entry.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-500">No entries yet.</p>
                      )
                    ) : null}
                  </div>
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
