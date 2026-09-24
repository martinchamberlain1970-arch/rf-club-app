"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import { supabase } from "@/lib/supabase";

type Competition = { id: string; name: string };
type Entry = { competition_id: string; player_id: string };
type Player = { id: string; display_name: string; full_name: string | null; snooker_handicap: number | null };
type ReviewStatus = { lastReviewedAt: string | null; nextReviewAt: string | null; intervalDays: number; movementLimit: null };
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

export default function HandicapsPage() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [linkedPlayerId, setLinkedPlayerId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus | null>(null);
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
        ? await client.from("players").select("id,display_name,full_name,snooker_handicap").in("id", playerIds)
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
      .map((player) => ({ ...player, name: playerName(player), handicap: Number(player.snooker_handicap ?? 0) }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [entries, players, selectedCompetitionId]);
  const ownRow = rows.find((row) => row.id === linkedPlayerId) ?? null;

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
                <h2 className="mt-2 text-xl font-black text-slate-950">{ownRow ? `Your handicap: ${ownRow.handicap > 0 ? "+" : ""}${ownRow.handicap}` : "Competition handicaps"}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-700">This is the player’s current Elo-aligned handicap. The exact <strong>match handicap start</strong> is calculated from the difference between both players and is shown on every fixture and match screen.</p>
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
                  <li>Any change applies immediately to every unplayed fixture. Completed results are never changed.</li>
                  <li>The Super User can also recalculate a new player manually between scheduled reviews.</li>
                </ul>
              </section>
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-bold text-slate-950">All player handicaps</h2><p className="mt-1 text-xs text-slate-500">Listed alphabetically. Match starts are capped at 40 points.</p></div>
                <div className="divide-y divide-slate-200">
                  {rows.map((row) => (
                    <div key={row.id} className={`flex items-center justify-between gap-4 px-4 py-3 ${row.id === linkedPlayerId ? "bg-emerald-50" : ""}`}>
                      <div><p className="font-semibold text-slate-900">{row.name}</p>{row.id === linkedPlayerId ? <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">You</span> : null}</div>
                      <span className="min-w-14 rounded-xl bg-slate-900 px-3 py-2 text-center text-lg font-black text-white">{row.handicap > 0 ? "+" : ""}{row.handicap}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
