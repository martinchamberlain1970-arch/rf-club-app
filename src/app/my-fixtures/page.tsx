"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import { supabase } from "@/lib/supabase";

type WeekFilter = "last" | "this" | "next";

type MatchRow = {
  id: string;
  competition_id: string;
  player1_id: string | null;
  player2_id: string | null;
  team1_player1_id: string | null;
  team1_player2_id: string | null;
  team2_player1_id: string | null;
  team2_player2_id: string | null;
  status: "pending" | "in_progress" | "complete" | "bye";
  scheduled_for: string | null;
  round_no: number | null;
  match_no: number | null;
};

type CompetitionRow = {
  id: string;
  name: string;
  sport_type: "snooker" | "pool_8_ball" | "pool_9_ball";
  competition_format: "knockout" | "league";
};

type PlayerRow = {
  id: string;
  display_name: string;
  full_name: string | null;
};

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function MyFixturesPage() {
  const [linkedPlayerId, setLinkedPlayerId] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [filter, setFilter] = useState<WeekFilter>("this");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const client = supabase;
      if (!client) return;
      const authRes = await client.auth.getUser();
      const userId = authRes.data.user?.id ?? null;
      if (!userId) return;
      const linkRes = await client.from("app_users").select("linked_player_id").eq("id", userId).maybeSingle();
      const playerId = linkRes.data?.linked_player_id ?? null;
      setLinkedPlayerId(playerId);
      if (!playerId) return;

      const matchesRes = await client
        .from("matches")
        .select("id,competition_id,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,status,scheduled_for,round_no,match_no")
        .eq("is_archived", false)
        .or(
          `player1_id.eq.${playerId},player2_id.eq.${playerId},team1_player1_id.eq.${playerId},team1_player2_id.eq.${playerId},team2_player1_id.eq.${playerId},team2_player2_id.eq.${playerId}`
        )
        .order("scheduled_for", { ascending: true })
        .order("round_no", { ascending: true })
        .order("match_no", { ascending: true });

      if (matchesRes.error) {
        setMessage(matchesRes.error.message);
        return;
      }

      const loadedMatches = ((matchesRes.data ?? []) as unknown) as MatchRow[];
      setMatches(loadedMatches);
      const competitionIds = [...new Set(loadedMatches.map((match) => match.competition_id).filter(Boolean))];
      const playerIds = [...new Set(
        loadedMatches.flatMap((match) =>
          [
            match.player1_id,
            match.player2_id,
            match.team1_player1_id,
            match.team1_player2_id,
            match.team2_player1_id,
            match.team2_player2_id,
          ].filter(Boolean) as string[]
        )
      )];

      const [competitionRes, playerRes] = await Promise.all([
        competitionIds.length
          ? client.from("competitions").select("id,name,sport_type,competition_format").in("id", competitionIds)
          : Promise.resolve({ data: [], error: null }),
        playerIds.length
          ? client.from("players").select("id,display_name,full_name").in("id", playerIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (competitionRes.error || playerRes.error) {
        setMessage(competitionRes.error?.message || playerRes.error?.message || "Failed to load fixtures.");
        return;
      }
      setCompetitions(((competitionRes.data ?? []) as unknown) as CompetitionRow[]);
      setPlayers(((playerRes.data ?? []) as unknown) as PlayerRow[]);
    };
    void run();
  }, []);

  const competitionById = useMemo(() => new Map(competitions.map((competition) => [competition.id, competition])), [competitions]);
  const playerNameById = useMemo(
    () => new Map(players.map((player) => [player.id, player.full_name?.trim() ? player.full_name : player.display_name])),
    [players]
  );

  const range = useMemo(() => {
    const thisWeekStart = startOfWeek(new Date());
    const currentStart =
      filter === "last" ? addDays(thisWeekStart, -7) : filter === "next" ? addDays(thisWeekStart, 7) : thisWeekStart;
    const currentEnd = addDays(currentStart, 6);
    return {
      from: isoDate(currentStart),
      to: isoDate(currentEnd),
      label: `${currentStart.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} - ${currentEnd.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`,
    };
  }, [filter]);

  const fixtureRows = useMemo(() => {
    return matches
      .filter((match) => match.scheduled_for && match.scheduled_for >= range.from && match.scheduled_for <= range.to)
      .map((match) => {
        const isDoubles = Boolean(match.team1_player1_id || match.team2_player1_id);
        const onTeamOne = isDoubles
          ? [match.team1_player1_id, match.team1_player2_id].includes(linkedPlayerId)
          : match.player1_id === linkedPlayerId;
        const myIds = isDoubles
          ? onTeamOne ? [match.team1_player1_id, match.team1_player2_id] : [match.team2_player1_id, match.team2_player2_id]
          : onTeamOne ? [match.player1_id] : [match.player2_id];
        const opponentIds = isDoubles
          ? onTeamOne ? [match.team2_player1_id, match.team2_player2_id] : [match.team1_player1_id, match.team1_player2_id]
          : onTeamOne ? [match.player2_id] : [match.player1_id];
        return {
          match,
          competition: competitionById.get(match.competition_id),
          myLabel: myIds.filter(Boolean).map((id) => playerNameById.get(id as string) ?? "TBC").join(" & "),
          opponentLabel: opponentIds.filter(Boolean).map((id) => playerNameById.get(id as string) ?? "TBC").join(" & ") || "BYE",
        };
      });
  }, [matches, range, linkedPlayerId, competitionById, playerNameById]);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <RequireAuth>
          <ScreenHeader title="My Fixtures" eyebrow="Player" subtitle="Your recent, current, and upcoming fixtures by week." />

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap gap-2">
              {([
                ["last", "Last Week"],
                ["this", "This Week"],
                ["next", "Next Week"],
              ] as Array<[WeekFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    filter === value ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-slate-600">{range.label}</p>
          </section>

          {message ? <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">{message}</section> : null}

          {!linkedPlayerId ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              No linked player profile found for this account yet.
            </section>
          ) : fixtureRows.length ? (
            <section className="space-y-3">
              {fixtureRows.map(({ match, competition, myLabel, opponentLabel }) => (
                <Link
                  key={match.id}
                  href={`/matches/${match.id}`}
                  className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">{competition?.name ?? "Competition fixture"}</p>
                    <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                      {match.status === "in_progress" ? "Live" : match.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{myLabel} vs {opponentLabel}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {competition?.competition_format === "league" ? `Week ${match.round_no ?? 1}` : `Round ${match.round_no ?? 1} · Match ${match.match_no ?? 1}`}
                    {match.scheduled_for ? ` · Plays by ${new Date(`${match.scheduled_for}T21:00:00`).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : ""}
                  </p>
                </Link>
              ))}
            </section>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600 shadow-sm">
              No fixtures found for this week selection.
            </section>
          )}
        </RequireAuth>
      </div>
    </main>
  );
}
