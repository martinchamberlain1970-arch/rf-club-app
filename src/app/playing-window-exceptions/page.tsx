"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import MessageModal from "@/components/MessageModal";
import useAdminStatus from "@/components/useAdminStatus";
import { supabase } from "@/lib/supabase";

type Competition = { id: string; name: string; sport_type: string };
type Entry = {
  competition_id: string;
  player_id: string;
  players: { id: string; display_name: string; full_name: string | null } | null;
};
type PlayingException = {
  id: string;
  competition_id: string;
  player_id: string;
  active_from: string;
  expires_on: string;
  note: string;
};
type ApiData = { competitions: Competition[]; entries: Entry[]; exceptions: PlayingException[]; error?: string };

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function displayDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export default function PlayingWindowExceptionsPage() {
  const admin = useAdminStatus();
  const [data, setData] = useState<ApiData>({ competitions: [], entries: [], exceptions: [] });
  const [competitionId, setCompetitionId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [activeFrom, setActiveFrom] = useState(todayIso);
  const [expiresOn, setExpiresOn] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const request = useCallback(async (url: string, init?: RequestInit) => {
    const client = supabase;
    if (!client) throw new Error("Supabase is not configured.");
    const session = await client.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error("Please sign in again.");
    const response = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } });
    const body = (await response.json().catch(() => ({}))) as ApiData;
    if (!response.ok) throw new Error(body.error ?? "The request could not be completed.");
    return body;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await request("/api/admin/playing-window-exceptions");
      setData(body);
      setCompetitionId((current) => current || body.competitions[0]?.id || "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load early-play exceptions.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (!admin.loading && admin.isSuper) void load();
  }, [admin.isSuper, admin.loading, load]);

  const eligibleEntries = useMemo(
    () => data.entries
      .filter((entry) => entry.competition_id === competitionId && entry.players)
      .sort((a, b) => {
        const nameA = a.players?.full_name?.trim() || a.players?.display_name || "";
        const nameB = b.players?.full_name?.trim() || b.players?.display_name || "";
        return nameA.localeCompare(nameB);
      }),
    [competitionId, data.entries]
  );
  const competitionName = useMemo(() => new Map(data.competitions.map((competition) => [competition.id, competition.name])), [data.competitions]);
  const playerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of data.entries) {
      if (entry.players) map.set(entry.player_id, entry.players.full_name?.trim() || entry.players.display_name);
    }
    return map;
  }, [data.entries]);

  const save = async () => {
    if (!competitionId || !playerId || !activeFrom || !expiresOn || note.trim().length < 5) {
      setMessage("Choose the competition, player, dates and add a short reason.");
      return;
    }
    setBusy(true);
    try {
      await request("/api/admin/playing-window-exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitionId, playerId, activeFrom, expiresOn, note: note.trim() }),
      });
      setMessage("Early-play exception saved. The player and every opponent in their unplayed fixtures can now enter results early until the expiry date.");
      setPlayerId("");
      setExpiresOn("");
      setNote("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save the exception.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (exception: PlayingException) => {
    setBusy(true);
    try {
      await request(`/api/admin/playing-window-exceptions?id=${encodeURIComponent(exception.id)}`, { method: "DELETE" });
      setMessage("Early-play exception removed. Normal fixture windows apply again.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove the exception.");
    } finally {
      setBusy(false);
    }
  };

  const today = todayIso();

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Early-play Exceptions"
            eyebrow="System"
            subtitle="Temporarily open future weekly fixtures for one competition entrant without moving those fixtures or changing anyone else's deadlines."
          />
          <MessageModal message={message} onClose={() => setMessage(null)} />

          {!admin.loading && !admin.isSuper ? <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">Super User access only.</section> : null}

          {admin.isSuper ? (
            <>
              <section className="rounded-3xl border border-cyan-200 bg-white p-5 shadow-sm">
                <h2 className="text-xl font-bold text-slate-950">Add or update an exception</h2>
                <p className="mt-1 text-sm text-slate-600">Both players can enter the result early for any unplayed fixture involving the selected entrant. Original weeks, final deadlines and reminder rules remain unchanged.</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-800">Competition
                    <select value={competitionId} onChange={(event) => { setCompetitionId(event.target.value); setPlayerId(""); }} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">
                      {data.competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-slate-800">Player
                    <select value={playerId} onChange={(event) => setPlayerId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">
                      <option value="">Choose an approved entrant</option>
                      {eligibleEntries.map((entry) => <option key={entry.player_id} value={entry.player_id}>{entry.players?.full_name?.trim() || entry.players?.display_name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-slate-800">Active from
                    <input type="date" value={activeFrom} onChange={(event) => setActiveFrom(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" />
                  </label>
                  <label className="text-sm font-semibold text-slate-800">Expires after
                    <input type="date" value={expiresOn} min={activeFrom} onChange={(event) => setExpiresOn(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" />
                  </label>
                  <label className="text-sm font-semibold text-slate-800 md:col-span-2">Reason shown on affected fixtures
                    <input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="For example: Early play permitted while the player prepares to travel." className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" />
                  </label>
                </div>
                <button type="button" disabled={busy || loading} onClick={() => void save()} className="mt-4 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Save early-play exception"}</button>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-xl font-bold text-slate-950">Current and previous exceptions</h2>
                {loading ? <p className="mt-3 text-slate-600">Loading…</p> : data.exceptions.length ? (
                  <div className="mt-4 space-y-3">
                    {data.exceptions.map((exception) => {
                      const status = exception.active_from > today ? "Scheduled" : exception.expires_on < today ? "Expired" : "Active";
                      return <article key={exception.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">{competitionName.get(exception.competition_id) ?? "Competition"}</p>
                            <h3 className="mt-1 text-lg font-bold text-slate-950">{playerName.get(exception.player_id) ?? "Player"}</h3>
                            <p className="mt-1 text-sm text-slate-700">{displayDate(exception.active_from)} to {displayDate(exception.expires_on)} · <strong>{status}</strong></p>
                            <p className="mt-2 text-sm text-slate-600">{exception.note}</p>
                          </div>
                          <button type="button" disabled={busy} onClick={() => void remove(exception)} className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-bold text-rose-800 disabled:opacity-50">Remove</button>
                        </div>
                      </article>;
                    })}
                  </div>
                ) : <p className="mt-3 text-slate-600">No early-play exceptions have been recorded.</p>}
              </section>
            </>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
