"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import { supabase } from "@/lib/supabase";
import { targetSnookerHandicapFromElo } from "@/lib/snooker-handicap";

type Competition = { id: string; name: string };
type Entry = { competition_id: string; player_id: string };
type Player = { id: string; display_name: string; full_name: string | null; snooker_handicap: number | null; rating_snooker: number | null };
type ReviewStatus = { lastReviewedAt: string | null; nextReviewAt: string | null; intervalDays: number; movementLimit: null };
type PlayerHistoryResult = {
  id: string;
  ratedAt: string | null;
  opponentName: string;
  won: boolean;
  before: number;
  after: number;
  delta: number;
  frames: Array<{ frameNumber: number; playerPoints: number; opponentPoints: number }>;
};
function playerName(player: Player) {
  return player.full_name?.trim() || player.display_name;
}

function reviewDate(value: string | null) {
  if (!value) return "Not yet recorded";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function resultDate(value: string | null) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

export default function HandicapsPage() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [linkedPlayerId, setLinkedPlayerId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus | null>(null);
  const [historyPlayerId, setHistoryPlayerId] = useState<string | null>(null);
  const [historyResults, setHistoryResults] = useState<PlayerHistoryResult[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    const run = async () => {
      setLoading(true);
      const auth = await client.auth.getUser();
      const userId = auth.data.user?.id;
      const [competitionResult, userResult, reviewResult] = await Promise.all([
        client
          .from("competitions")
          .select("id,name")
          .eq("sport_type", "snooker")
          .eq("handicap_enabled", true)
          .eq("is_archived", false)
          .eq("is_completed", false)
          .order("created_at", { ascending: false }),
        userId ? client.from("app_users").select("linked_player_id").eq("id", userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
        fetch("/api/snooker-handicaps/review-status", { cache: "no-store" })
          .then(async (response) => response.ok ? await response.json() as ReviewStatus : null)
          .catch(() => null),
      ]);
      if (!active) return;
      if (competitionResult.error) {
        setMessage(competitionResult.error.message);
        setLoading(false);
        return;
      }
      const loadedCompetitions = (competitionResult.data ?? []) as Competition[];
      setCompetitions(loadedCompetitions);
      setLinkedPlayerId(userResult.data?.linked_player_id ?? null);
      setReviewStatus(reviewResult);
      const competitionIds = loadedCompetitions.map((competition) => competition.id);
      if (!competitionIds.length) {
        setLoading(false);
        return;
      }
      const entryResult = await client.from("competition_entries").select("competition_id,player_id").in("competition_id", competitionIds).eq("status", "approved");
      if (!active) return;
      if (entryResult.error) {
        setMessage(entryResult.error.message);
        setLoading(false);
        return;
      }
      const loadedEntries = (entryResult.data ?? []) as Entry[];
      const playerIds = [...new Set(loadedEntries.map((entry) => entry.player_id))];
      const playerResult = playerIds.length
        ? await client.from("players").select("id,display_name,full_name,snooker_handicap,rating_snooker").in("id", playerIds)
        : { data: [], error: null };
      if (!active) return;
      if (playerResult.error) setMessage(playerResult.error.message);
      setEntries(loadedEntries);
      setPlayers((playerResult.data ?? []) as Player[]);
      setSelectedCompetitionId((current) => current || loadedCompetitions[0]?.id || "");
      setLoading(false);
    };
    void run();
    return () => { active = false; };
  }, []);

  const selectedCompetition = competitions.find((competition) => competition.id === selectedCompetitionId) ?? null;
  const rows = useMemo(() => {
    const entrantIds = entries.filter((entry) => entry.competition_id === selectedCompetitionId).map((entry) => entry.player_id);
    return players
      .filter((player) => entrantIds.includes(player.id))
      .map((player) => ({
        ...player,
        name: playerName(player),
        handicap: Number(player.snooker_handicap ?? 0),
        indicativeHandicap: targetSnookerHandicapFromElo(Math.round(player.rating_snooker ?? 1000)),
      }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [entries, players, selectedCompetitionId]);
  const ownRow = rows.find((row) => row.id === linkedPlayerId) ?? null;
  const historyPlayer = rows.find((row) => row.id === historyPlayerId) ?? null;

  const openPlayerHistory = async (playerId: string) => {
    setHistoryPlayerId(playerId);
    setHistoryResults([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const client = supabase;
      if (!client) throw new Error("Supabase is not configured.");
      const session = await client.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("Your session has expired. Please sign in again.");
      const response = await fetch(`/api/snooker-handicaps/player-history?competitionId=${encodeURIComponent(selectedCompetitionId)}&playerId=${encodeURIComponent(playerId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json() as { results?: PlayerHistoryResult[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to load Elo history.");
      setHistoryResults(payload.results ?? []);
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : "Unable to load Elo history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 p-3 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="Handicaps" eyebrow="Player" subtitle="See your competition handicap and the handicaps of the other snooker entrants." />
          {message ? <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">{message}</section> : null}
          {loading ? <section className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm">Loading handicaps…</section> : null}
          {!loading && !competitions.length ? <section className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-600 shadow-sm">There are no active handicapped snooker competitions.</section> : null}
          {!loading && competitions.length ? (
            <>
              {competitions.length > 1 ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <label className="text-sm font-semibold text-slate-700">Competition
                    <select value={selectedCompetitionId} onChange={(event) => setSelectedCompetitionId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">
                      {competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}
                    </select>
                  </label>
                </section>
              ) : null}
              <section className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">{selectedCompetition?.name}</p>
                <h2 className="mt-2 text-xl font-black text-slate-950">{ownRow ? `Your active handicap: ${ownRow.handicap > 0 ? "+" : ""}${ownRow.handicap}` : "Competition handicaps"}</h2>
                {ownRow ? <p className="mt-2 text-sm font-semibold text-sky-900">If reviewed today from your current Elo: {ownRow.indicativeHandicap > 0 ? "+" : ""}{ownRow.indicativeHandicap}</p> : null}
                <p className="mt-2 text-sm leading-6 text-slate-700">The active figure was set at the last scheduled review. The exact <strong>match handicap start</strong> is calculated from the difference between both players and is shown on every fixture and match screen.</p>
                <p className="mt-1 text-xs text-slate-600">A lower handicap represents the stronger player. Only the difference is applied as the match start.</p>
              </section>
              <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">How handicaps are reviewed</p>
                <h2 className="mt-2 text-lg font-black text-slate-950">Automatic Elo review every four weeks</h2>
                <div className="mt-3 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                  <div className="rounded-xl bg-white p-3"><span className="block text-xs font-bold uppercase tracking-wide text-slate-500">Last review</span><strong>{reviewDate(reviewStatus?.lastReviewedAt ?? null)}</strong></div>
                  <div className="rounded-xl bg-white p-3"><span className="block text-xs font-bold uppercase tracking-wide text-slate-500">Next review due</span><strong>{reviewDate(reviewStatus?.nextReviewAt ?? null)}</strong></div>
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                  <li>The calculation starts at Elo 1000: every five Elo points changes the handicap by one point, rounded to the nearest four.</li>
                  <li>There is no maximum movement at a review—the handicap moves directly to its Elo-aligned figure.</li>
                  <li>The indicative figure below is recalculated from each player’s latest Elo, so players can see what their handicap would be if a review happened today.</li>
                  <li>Any change applies immediately to every unplayed fixture. Completed results are never changed.</li>
                  <li>The Super User can also recalculate a new player manually between scheduled reviews.</li>
                </ul>
              </section>
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-bold text-slate-950">All player handicaps</h2><p className="mt-1 text-xs text-slate-500">Listed alphabetically. “If reviewed today” is a guide only; the active handicap changes at the scheduled four-week review. Match starts are capped at 40 points.</p></div>
                <div className="divide-y divide-slate-200">
                  {rows.map((row) => (
                    <div key={row.id} className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${row.id === linkedPlayerId ? "bg-emerald-50" : ""}`}>
                      <div>
                        <button type="button" onClick={() => void openPlayerHistory(row.id)} className="text-left font-semibold text-slate-900 underline decoration-sky-300 decoration-2 underline-offset-4 hover:text-sky-800">{row.name}</button>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold text-slate-700">Current Elo {Math.round(row.rating_snooker ?? 1000)}</span>
                          <span className="text-sky-700">View rated results</span>
                          {row.id === linkedPlayerId ? <span className="font-bold uppercase tracking-wide text-emerald-700">You</span> : null}
                        </div>
                      </div>
                      <div className="grid w-full grid-cols-2 gap-2 text-center sm:w-auto">
                        <div><span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Active</span><span className="mt-1 block min-w-14 rounded-xl bg-slate-900 px-3 py-2 text-lg font-black text-white">{row.handicap > 0 ? "+" : ""}{row.handicap}</span></div>
                        <div><span className="block text-[10px] font-bold uppercase tracking-wide text-sky-700">If reviewed today</span><span className={`mt-1 block min-w-14 rounded-xl px-3 py-2 text-lg font-black ${row.indicativeHandicap === row.handicap ? "bg-slate-100 text-slate-700" : "bg-sky-100 text-sky-900"}`}>{row.indicativeHandicap > 0 ? "+" : ""}{row.indicativeHandicap}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              {historyPlayer ? (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="rating-history-title" onClick={() => setHistoryPlayerId(null)}>
                  <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                    <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Snooker Elo history</p>
                        <h2 id="rating-history-title" className="mt-1 text-xl font-black text-slate-950">{historyPlayer.name}</h2>
                        <p className="mt-1 text-sm text-slate-600">Current Elo <strong>{Math.round(historyPlayer.rating_snooker ?? 1000)}</strong>{!historyLoading && !historyError ? ` · ${historyResults.length} rated result${historyResults.length === 1 ? "" : "s"}` : ""}</p>
                      </div>
                      <button type="button" onClick={() => setHistoryPlayerId(null)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Close</button>
                    </div>
                    <div className="max-h-[calc(90vh-110px)] overflow-y-auto p-4 sm:p-5">
                      <p className="mb-4 text-sm leading-6 text-slate-600">Masters league matches are single-frame matches, so each result below shows the Elo before and after that rated frame. Multi-frame matches receive one Elo change when the match is completed.</p>
                      {historyLoading ? <p className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-900">Loading rated results…</p> : null}
                      {historyError ? <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{historyError}</p> : null}
                      {!historyLoading && !historyError && historyResults.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No rated results are recorded for this player in this competition yet.</p> : null}
                      <div className="space-y-3">
                        {historyResults.map((result) => (
                          <article key={result.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{resultDate(result.ratedAt)}</p>
                                <h3 className="mt-1 font-bold text-slate-950">vs {result.opponentName}</h3>
                                <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${result.won ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>{result.won ? "Won" : "Lost"}</span>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-slate-700">Elo {result.before} → {result.after}</p>
                                <p className={`mt-1 text-lg font-black ${result.delta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{signed(result.delta)}</p>
                              </div>
                            </div>
                            {result.frames.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {result.frames.map((frame) => (
                                  <span key={`${result.id}-${frame.frameNumber}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">Frame {frame.frameNumber}: {frame.playerPoints}–{frame.opponentPoints}</span>
                                ))}
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
