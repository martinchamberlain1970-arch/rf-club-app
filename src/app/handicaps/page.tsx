"use client";

import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import { supabase } from "@/lib/supabase";

type Competition = { id: string; name: string };
type Entry = { competition_id: string; player_id: string };
type Player = { id: string; display_name: string; full_name: string | null; snooker_handicap: number | null };
type Match = {
  competition_id: string;
  player1_id: string | null;
  player2_id: string | null;
  status: string;
  team1_handicap_start: number | null;
  team2_handicap_start: number | null;
};

function playerName(player: Player) {
  return player.full_name?.trim() || player.display_name;
}

function deriveCompetitionHandicaps(playerIds: string[], matches: Match[], fallbackByPlayer: Map<string, number>) {
  const links = new Map<string, Array<{ playerId: string; difference: number }>>();
  for (const playerId of playerIds) links.set(playerId, []);
  for (const match of matches) {
    if (!["pending", "in_progress"].includes(match.status) || !match.player1_id || !match.player2_id || match.player1_id === match.player2_id) continue;
    const first = Number(match.team1_handicap_start ?? 0);
    const second = Number(match.team2_handicap_start ?? 0);
    const difference = second - first;
    links.get(match.player1_id)?.push({ playerId: match.player2_id, difference });
    links.get(match.player2_id)?.push({ playerId: match.player1_id, difference: -difference });
  }

  const resolved = new Map<string, number>();
  const visited = new Set<string>();
  for (const root of playerIds) {
    if (visited.has(root)) continue;
    const component = new Map<string, number>([[root, 0]]);
    const queue = [root];
    visited.add(root);
    while (queue.length) {
      const current = queue.shift() as string;
      for (const link of links.get(current) ?? []) {
        if (component.has(link.playerId)) continue;
        component.set(link.playerId, (component.get(current) ?? 0) + link.difference);
        visited.add(link.playerId);
        queue.push(link.playerId);
      }
    }
    if (component.size > 1) {
      const minimum = Math.min(...component.values());
      for (const [playerId, value] of component) resolved.set(playerId, Math.max(0, Math.round(value - minimum)));
    } else {
      resolved.set(root, Math.max(0, Number(fallbackByPlayer.get(root) ?? 0)));
    }
  }
  return resolved;
}

export default function HandicapsPage() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [linkedPlayerId, setLinkedPlayerId] = useState<string | null>(null);
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
      const [competitionResult, userResult] = await Promise.all([
        client
          .from("competitions")
          .select("id,name")
          .eq("sport_type", "snooker")
          .eq("handicap_enabled", true)
          .eq("is_archived", false)
          .eq("is_completed", false)
          .order("created_at", { ascending: false }),
        userId ? client.from("app_users").select("linked_player_id").eq("id", userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
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
      const competitionIds = loadedCompetitions.map((competition) => competition.id);
      if (!competitionIds.length) {
        setLoading(false);
        return;
      }
      const [entryResult, matchResult] = await Promise.all([
        client.from("competition_entries").select("competition_id,player_id").in("competition_id", competitionIds).eq("status", "approved"),
        client
          .from("matches")
          .select("competition_id,player1_id,player2_id,status,team1_handicap_start,team2_handicap_start")
          .in("competition_id", competitionIds)
          .eq("is_archived", false),
      ]);
      if (!active) return;
      if (entryResult.error || matchResult.error) {
        setMessage(entryResult.error?.message || matchResult.error?.message || "Handicaps could not be loaded.");
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
      setMatches((matchResult.data ?? []) as Match[]);
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
    const fallback = new Map(players.map((player) => [player.id, Number(player.snooker_handicap ?? 0)]));
    const handicaps = deriveCompetitionHandicaps(
      entrantIds,
      matches.filter((match) => match.competition_id === selectedCompetitionId),
      fallback
    );
    return players
      .filter((player) => entrantIds.includes(player.id))
      .map((player) => ({ ...player, name: playerName(player), handicap: handicaps.get(player.id) ?? 0 }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [entries, matches, players, selectedCompetitionId]);
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
                <h2 className="mt-2 text-xl font-black text-slate-950">{ownRow ? `Your handicap: ${ownRow.handicap}` : "Competition handicaps"}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-700">This is the player’s competition handicap. The exact <strong>match handicap start</strong> is calculated for each pairing and is shown on every fixture and match screen.</p>
              </section>
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-bold text-slate-950">All player handicaps</h2><p className="mt-1 text-xs text-slate-500">Listed alphabetically. Match starts are capped at 40 points.</p></div>
                <div className="divide-y divide-slate-200">
                  {rows.map((row) => (
                    <div key={row.id} className={`flex items-center justify-between gap-4 px-4 py-3 ${row.id === linkedPlayerId ? "bg-emerald-50" : ""}`}>
                      <div><p className="font-semibold text-slate-900">{row.name}</p>{row.id === linkedPlayerId ? <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">You</span> : null}</div>
                      <span className="min-w-14 rounded-xl bg-slate-900 px-3 py-2 text-center text-lg font-black text-white">{row.handicap}</span>
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
