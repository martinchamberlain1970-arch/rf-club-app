"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import { supabase } from "@/lib/supabase";

type DisciplineFilter = "snooker" | "pool";
type Player = {
  id: string;
  display_name: string;
  full_name: string | null;
  is_archived?: boolean;
  claimed_by?: string | null;
  location_id?: string | null;
  rating_pool?: number | null;
  rating_snooker?: number | null;
  peak_rating_pool?: number | null;
  peak_rating_snooker?: number | null;
  rated_matches_pool?: number | null;
  rated_matches_snooker?: number | null;
  snooker_handicap?: number | null;
  snooker_handicap_base?: number | null;
};
type Location = { id: string; name: string };
type Competition = {
  id: string;
  sport_type: "snooker" | "pool_8_ball" | "pool_9_ball";
  is_archived?: boolean | null;
  is_completed?: boolean | null;
};
type CompetitionEntry = {
  competition_id: string;
  player_id: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
};
type MatchRow = {
  competition_id: string;
  status: "pending" | "in_progress" | "complete" | "bye";
  updated_at: string | null;
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
};

const LIVE_ACTIVITY_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

function getDisciplineMeta(discipline: DisciplineFilter) {
  return discipline === "snooker"
    ? {
        label: "Snooker Rankings",
        accent: "from-amber-50 via-white to-orange-50",
        badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
        cardClass: "border-amber-200 bg-amber-50/70",
      }
    : {
        label: "Pool Rankings",
        accent: "from-cyan-50 via-white to-fuchsia-50",
        badgeClass: "border-cyan-200 bg-cyan-50 text-cyan-800",
        cardClass: "border-cyan-200 bg-cyan-50/70",
      };
}

export default function RankingsPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionEntries, setCompetitionEntries] = useState<CompetitionEntry[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [discipline, setDiscipline] = useState<DisciplineFilter>("snooker");
  const [locationFilter, setLocationFilter] = useState<string>("all");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;

    const run = async () => {
      const [playerRes, locationRes, competitionRes, entryRes, matchRes] = await Promise.all([
        client
          .from("players")
          .select(
            "id,display_name,full_name,is_archived,claimed_by,location_id,rating_pool,rating_snooker,peak_rating_pool,peak_rating_snooker,rated_matches_pool,rated_matches_snooker,snooker_handicap,snooker_handicap_base"
          )
          .eq("is_archived", false),
        client.from("locations").select("id,name").order("name"),
        client.from("competitions").select("id,sport_type,is_archived,is_completed"),
        client.from("competition_entries").select("competition_id,player_id,status"),
        client.from("matches").select("competition_id,status,updated_at,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id"),
      ]);

      if (!active) return;
      if (playerRes.error || locationRes.error || competitionRes.error || entryRes.error || matchRes.error) {
        setMessage(
          playerRes.error?.message ||
          locationRes.error?.message ||
          competitionRes.error?.message ||
          entryRes.error?.message ||
          matchRes.error?.message ||
          "Failed to load rankings."
        );
        return;
      }
      setPlayers((playerRes.data ?? []) as Player[]);
      setLocations((locationRes.data ?? []) as Location[]);
      setCompetitions((competitionRes.data ?? []) as Competition[]);
      setCompetitionEntries((entryRes.data ?? []) as CompetitionEntry[]);
      setMatches((matchRes.data ?? []) as MatchRow[]);
    };

    run();
    return () => {
      active = false;
    };
  }, []);

  const locationMap = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations]);
  const livePlayerIdsByDiscipline = useMemo(() => {
    const now = Date.now();
    const recentCutoff = now - LIVE_ACTIVITY_WINDOW_MS;
    const competitionById = new Map(competitions.map((competition) => [competition.id, competition]));
    const result = {
      snooker: new Set<string>(),
      pool: new Set<string>(),
    };
    for (const player of players) {
      if (player.claimed_by) {
        result.snooker.add(player.id);
        result.pool.add(player.id);
      }
    }
    for (const entry of competitionEntries) {
      if (entry.status === "rejected" || entry.status === "withdrawn") continue;
      const competition = competitionById.get(entry.competition_id);
      if (!competition || competition.is_archived || competition.is_completed) continue;
      if (competition.sport_type === "snooker") {
        result.snooker.add(entry.player_id);
      } else {
        result.pool.add(entry.player_id);
      }
    }
    for (const match of matches) {
      const competition = competitionById.get(match.competition_id);
      if (!competition) continue;
      const participantIds = [
        match.player1_id,
        match.player2_id,
        match.team1_player1_id,
        match.team1_player2_id,
        match.team2_player1_id,
        match.team2_player2_id,
      ].filter((value): value is string => Boolean(value));
      if (participantIds.length === 0) continue;
      const disciplineKey = competition.sport_type === "snooker" ? "snooker" : "pool";
      if (!competition.is_archived && !competition.is_completed) {
        participantIds.forEach((playerId) => result[disciplineKey].add(playerId));
      }
      const playedRecently =
        match.status === "complete" &&
        Boolean(match.updated_at) &&
        new Date(match.updated_at as string).getTime() >= recentCutoff;
      if (playedRecently) {
        participantIds.forEach((playerId) => result[disciplineKey].add(playerId));
      }
    }
    return result;
  }, [competitionEntries, competitions, matches, players]);
  const filteredPlayers = useMemo(() => {
    const liveIds = livePlayerIdsByDiscipline[discipline];
    const visible = (locationFilter === "all" ? players : players.filter((player) => player.location_id === locationFilter))
      .filter((player) => liveIds.has(player.id))
      .filter((player) => (discipline === "snooker" ? Number(player.rated_matches_snooker ?? 0) > 0 : Number(player.rated_matches_pool ?? 0) > 0));
    return [...visible].sort((a, b) => {
      const aRating = discipline === "snooker" ? a.rating_snooker ?? 1000 : a.rating_pool ?? 1000;
      const bRating = discipline === "snooker" ? b.rating_snooker ?? 1000 : b.rating_pool ?? 1000;
      if (bRating !== aRating) return bRating - aRating;
      return (a.full_name?.trim() || a.display_name).localeCompare(b.full_name?.trim() || b.display_name);
    });
  }, [discipline, livePlayerIdsByDiscipline, locationFilter, players]);
  const disciplineMeta = getDisciplineMeta(discipline);
  const topPlayer = filteredPlayers[0] ?? null;
  const highestPeak =
    filteredPlayers.length > 0
      ? Math.max(
          ...filteredPlayers.map((player) =>
            Math.round(discipline === "snooker" ? player.peak_rating_snooker ?? 1000 : player.peak_rating_pool ?? 1000)
          )
        )
      : 0;
  const averageRating =
    filteredPlayers.length > 0
      ? Math.round(
          filteredPlayers.reduce((total, player) => {
            const rating = discipline === "snooker" ? player.rating_snooker ?? 1000 : player.rating_pool ?? 1000;
            return total + rating;
          }, 0) / filteredPlayers.length
        )
      : 0;

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="Player Rankings"
            eyebrow="Stats"
            subtitle="Elo-style leaderboards for live players, with discipline, location, and snooker handicap context."
          />
          {message ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">{message}</p> : null}
          <section className={`rounded-3xl border border-slate-200 bg-gradient-to-r ${disciplineMeta.accent} p-5 shadow-sm`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${disciplineMeta.badgeClass}`}>
                  {disciplineMeta.label}
                </span>
                <p className="max-w-2xl text-sm text-slate-700">
                  Ratings use the current Elo-style values stored on each player profile. Singles results feed the rating model; doubles, BYE, walkover, and void outcomes are excluded. Snooker current and baseline handicap are shown for review context.
                </p>
              </div>
              <div className="grid min-w-[220px] flex-1 gap-3 sm:grid-cols-3">
                <div className="flex min-h-[108px] flex-col justify-between rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="min-h-[2rem] text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Highest peak</p>
                  <div className="mt-2 flex min-h-[2.5rem] items-end">
                    <p className="text-2xl font-semibold leading-none text-slate-900">{filteredPlayers.length ? highestPeak : "—"}</p>
                  </div>
                </div>
                <div className="flex min-h-[108px] flex-col justify-between rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="min-h-[2rem] text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Top rating</p>
                  <div className="mt-2 flex min-h-[2.5rem] items-end">
                    <p className="text-2xl font-semibold leading-none text-slate-900">
                      {topPlayer ? Math.round(discipline === "snooker" ? topPlayer.rating_snooker ?? 1000 : topPlayer.rating_pool ?? 1000) : "—"}
                    </p>
                  </div>
                </div>
                <div className="flex min-h-[108px] flex-col justify-between rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm">
                  <p className="min-h-[2rem] text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Average rating</p>
                  <div className="mt-2 flex min-h-[2.5rem] items-end">
                    <p className="text-2xl font-semibold leading-none text-slate-900">{filteredPlayers.length ? averageRating : "—"}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[180px] flex-col gap-1 text-sm text-slate-700">
                Discipline
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={discipline}
                  onChange={(e) => setDiscipline(e.target.value as DisciplineFilter)}
                >
                  <option value="snooker">Snooker</option>
                  <option value="pool">Pool (8-ball and 9-ball)</option>
                </select>
              </label>
              <label className="flex min-w-[220px] flex-col gap-1 text-sm text-slate-700">
                Location
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                >
                  <option value="all">All locations</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm text-slate-700 ${disciplineMeta.cardClass}`}>
              Use the filters to compare players by discipline and location. Rankings are ordered by current Elo-style rating, with peak, rated-match totals, and snooker handicap context shown for review.
            </div>
          </section>

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm font-semibold text-slate-900">
                {discipline === "snooker" ? "Snooker" : "Pool"} rankings
              </p>
              <p className="text-sm text-slate-600">{filteredPlayers.length} live players</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-white">
                  <tr className="text-left text-slate-500">
                    <th className="px-4 py-3 font-medium">Rank</th>
                    <th className="px-4 py-3 font-medium">Player</th>
                    <th className="px-4 py-3 font-medium">Location</th>
                    <th className="px-4 py-3 font-medium">Rating</th>
                  <th className="px-4 py-3 font-medium">Peak</th>
                  {discipline === "snooker" ? <th className="px-4 py-3 font-medium">Current</th> : null}
                  {discipline === "snooker" ? <th className="px-4 py-3 font-medium">Baseline</th> : null}
                  <th className="px-4 py-3 font-medium">Rated matches</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredPlayers.map((player, index) => {
                    const rating = discipline === "snooker" ? player.rating_snooker ?? 1000 : player.rating_pool ?? 1000;
                    const peak = discipline === "snooker" ? player.peak_rating_snooker ?? 1000 : player.peak_rating_pool ?? 1000;
                    const ratedMatches =
                      discipline === "snooker" ? player.rated_matches_snooker ?? 0 : player.rated_matches_pool ?? 0;
                    const playerName = player.full_name?.trim() ? player.full_name : player.display_name;
                    return (
                      <tr key={player.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          <span className="inline-flex min-w-[46px] items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">
                            #{index + 1}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/players/${player.id}`} className="font-medium text-teal-700 underline">
                            {playerName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{locationMap.get(player.location_id ?? "") ?? "Not set"}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{Math.round(rating)}</td>
                        <td className="px-4 py-3 text-slate-600">{ratedMatches > 0 ? Math.round(peak) : "Baseline"}</td>
                        {discipline === "snooker" ? (
                          <td className="px-4 py-3 text-slate-600">
                            {player.snooker_handicap === null || player.snooker_handicap === undefined
                              ? "—"
                              : player.snooker_handicap > 0
                                ? `+${player.snooker_handicap}`
                                : String(player.snooker_handicap)}
                          </td>
                        ) : null}
                        {discipline === "snooker" ? (
                          <td className="px-4 py-3 text-slate-600">
                            {player.snooker_handicap_base === null || player.snooker_handicap_base === undefined
                              ? "—"
                              : player.snooker_handicap_base > 0
                                ? `+${player.snooker_handicap_base}`
                                : String(player.snooker_handicap_base)}
                          </td>
                        ) : null}
                        <td className="px-4 py-3 text-slate-600">{ratedMatches}</td>
                      </tr>
                    );
                  })}
                  {!filteredPlayers.length ? (
                    <tr>
                      <td colSpan={discipline === "snooker" ? 8 : 6} className="px-4 py-6 text-center text-slate-500">
                        No players match the current ranking filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </RequireAuth>
      </div>
    </main>
  );
}
