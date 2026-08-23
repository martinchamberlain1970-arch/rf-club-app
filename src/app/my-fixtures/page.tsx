"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import RequireAuth from "@/components/RequireAuth";
import PageNav from "@/components/PageNav";
import { supabase } from "@/lib/supabase";
import { getLeagueFixtureDeadline } from "@/lib/league-deadline";

type WeekFilter = "last" | "this" | "next";
type FixtureView = "weekly" | "all" | "results" | "tables";

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
  opening_break_player_id: string | null;
  winner_player_id: string | null;
  best_of: number;
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

type FrameRow = { match_id: string; winner_player_id: string | null };
type LeagueTableRow = { playerId: string; playerName: string; played: number; won: number; lost: number; voided: number; points: number };
type LeagueData = { competition: CompetitionRow; table: LeagueTableRow[]; updatedAt: string };

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

const competitionFilterKey = (name: string | undefined) => (name ?? "Competition").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
const fixtureTimingLabel = (scheduledFor: string | null, isLeague: boolean, complete: boolean, competitionName?: string) => {
  if (!scheduledFor) return "";
  if (isLeague) {
    const start = new Date(`${scheduledFor.slice(0, 10)}T13:00:00`);
    const deadline = getLeagueFixtureDeadline(scheduledFor, competitionName);
    if (deadline) return ` · Window ${start.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} – ${deadline.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}`;
  }
  return ` · ${complete ? "Played" : "Plays by"} ${new Date(`${scheduledFor.slice(0, 10)}T21:00:00`).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`;
};

export default function MyFixturesPage() {
  const [linkedPlayerId, setLinkedPlayerId] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [frames, setFrames] = useState<FrameRow[]>([]);
  const [leagueData, setLeagueData] = useState<Record<string, LeagueData>>({});
  const [filter, setFilter] = useState<WeekFilter>("this");
  const [view, setView] = useState<FixtureView>("weekly");
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [fixtureCompetitionFilter, setFixtureCompetitionFilter] = useState("all");
  const [opponentFilter, setOpponentFilter] = useState("all");
  const [message, setMessage] = useState<string | null>(null);
  const cardClass = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";

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
        .select("id,competition_id,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,status,scheduled_for,round_no,match_no,opening_break_player_id,winner_player_id,best_of")
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

      const [competitionRes, playerRes, framesRes] = await Promise.all([
        competitionIds.length
          ? client.from("competitions").select("id,name,sport_type,competition_format").in("id", competitionIds)
          : Promise.resolve({ data: [], error: null }),
        playerIds.length
          ? client.from("players").select("id,display_name,full_name").in("id", playerIds)
          : Promise.resolve({ data: [], error: null }),
        loadedMatches.length
          ? client.from("frames").select("match_id,winner_player_id").in("match_id", loadedMatches.map((match) => match.id))
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (competitionRes.error || playerRes.error || framesRes.error) {
        setMessage(competitionRes.error?.message || playerRes.error?.message || framesRes.error?.message || "Failed to load fixtures.");
        return;
      }
      const loadedCompetitions = ((competitionRes.data ?? []) as unknown) as CompetitionRow[];
      setCompetitions(loadedCompetitions);
      setPlayers(((playerRes.data ?? []) as unknown) as PlayerRow[]);
      setFrames(((framesRes.data ?? []) as unknown) as FrameRow[]);
      const leagueResponses = await Promise.all(loadedCompetitions.filter((competition) => competition.competition_format === "league").map(async (competition) => {
        const response = await fetch(`/api/public/leagues/${encodeURIComponent(competition.id)}`, { cache: "no-store" });
        if (!response.ok) return null;
        return [competition.id, await response.json() as LeagueData] as const;
      }));
      setLeagueData(Object.fromEntries(leagueResponses.filter((entry): entry is readonly [string, LeagueData] => Boolean(entry))));
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

  const allFixtureRows = useMemo(() => {
    const framesByMatch = new Map<string, FrameRow[]>();
    for (const frame of frames) framesByMatch.set(frame.match_id, [...(framesByMatch.get(frame.match_id) ?? []), frame]);
    return matches.map((match) => {
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
        const teamOneIds = (isDoubles ? [match.team1_player1_id, match.team1_player2_id] : [match.player1_id]).filter(Boolean);
        const teamTwoIds = (isDoubles ? [match.team2_player1_id, match.team2_player2_id] : [match.player2_id]).filter(Boolean);
        const matchFrames = framesByMatch.get(match.id) ?? [];
        let teamOneScore = matchFrames.filter((frame) => frame.winner_player_id && teamOneIds.includes(frame.winner_player_id)).length;
        let teamTwoScore = matchFrames.filter((frame) => frame.winner_player_id && teamTwoIds.includes(frame.winner_player_id)).length;
        if (!matchFrames.length && match.winner_player_id) {
          teamOneScore = teamOneIds.includes(match.winner_player_id) ? 1 : 0;
          teamTwoScore = teamTwoIds.includes(match.winner_player_id) ? 1 : 0;
        }
        return {
          match,
          competition: competitionById.get(match.competition_id),
          myLabel: myIds.filter(Boolean).map((id) => playerNameById.get(id as string) ?? "TBC").join(" & "),
          opponentLabel: opponentIds.filter(Boolean).map((id) => playerNameById.get(id as string) ?? "TBC").join(" & ") || "BYE",
          opponentIds: opponentIds.filter(Boolean) as string[],
          scoreLabel: match.status === "complete" ? (!match.winner_player_id ? "VOID" : onTeamOne ? `${teamOneScore} – ${teamTwoScore}` : `${teamTwoScore} – ${teamOneScore}`) : null,
        };
      });
  }, [competitionById, frames, linkedPlayerId, matches, playerNameById]);

  const fixtureRows = useMemo(() => allFixtureRows.filter(({ match }) => match.scheduled_for && match.scheduled_for >= range.from && match.scheduled_for <= range.to), [allFixtureRows, range]);
  const resultRows = useMemo(() => allFixtureRows.filter(({ match }) => match.status === "complete"), [allFixtureRows]);
  const filterSourceRows = view === "results" ? resultRows : allFixtureRows;
  const fixtureCompetitionOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const { competition } of filterSourceRows) {
      if (competition) options.set(competitionFilterKey(competition.name), competition.name.trim().replace(/\s+/g, " "));
    }
    return [...options].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [filterSourceRows]);
  const opponentOptions = useMemo(() => {
    const rows = fixtureCompetitionFilter === "all" ? filterSourceRows : filterSourceRows.filter(({ competition }) => competitionFilterKey(competition?.name) === fixtureCompetitionFilter);
    return [...new Set(rows.flatMap((row) => row.opponentIds))].map((id) => ({ id, name: playerNameById.get(id) ?? "Player" })).sort((a, b) => a.name.localeCompare(b.name));
  }, [filterSourceRows, fixtureCompetitionFilter, playerNameById]);
  const filteredFixtureRows = useMemo(() => filterSourceRows.filter(({ competition, opponentIds }) => (fixtureCompetitionFilter === "all" || competitionFilterKey(competition?.name) === fixtureCompetitionFilter) && (opponentFilter === "all" || opponentIds.includes(opponentFilter))), [filterSourceRows, fixtureCompetitionFilter, opponentFilter]);
  const leagueCompetitions = useMemo(() => competitions.filter((competition) => competition.competition_format === "league" && leagueData[competition.id]), [competitions, leagueData]);
  const activeLeagueId = selectedLeagueId || leagueCompetitions[0]?.id || "";
  const activeLeague = activeLeagueId ? leagueData[activeLeagueId] : null;

  const renderFixtureCards = (rows: typeof allFixtureRows, emptyMessage: string) => rows.length ? (
    <section className="space-y-3">
      {rows.map(({ match, competition, myLabel, opponentLabel, scoreLabel }) => (
        <Link key={match.id} href={`/matches/${match.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-slate-900">{competition?.name ?? "Competition fixture"}</p>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${match.status === "complete" ? "border-blue-200 bg-blue-50 text-blue-800" : match.status === "in_progress" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-slate-50 text-slate-700"}`}>
              {match.status === "complete" ? "Result" : match.status === "in_progress" ? "Live" : match.status === "bye" ? "BYE" : "Scheduled"}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center text-sm text-slate-800"><span>{myLabel}</span><strong className="min-w-14 rounded-lg bg-slate-900 px-2 py-1.5 text-white">{scoreLabel ?? "v"}</strong><span>{opponentLabel}</span></div>
          <p className="mt-2 text-xs text-slate-500">
            {competition?.competition_format === "league" ? `Week ${match.round_no ?? 1}` : `Round ${match.round_no ?? 1} · Match ${match.match_no ?? 1}`}
            {fixtureTimingLabel(match.scheduled_for, competition?.competition_format === "league", match.status === "complete", competition?.name)}
          </p>
          {match.opening_break_player_id ? <p className="mt-2 text-xs font-semibold text-emerald-700">Opening break: {playerNameById.get(match.opening_break_player_id) ?? "Assigned player"}</p> : null}
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-teal-700">Open fixture</p>
        </Link>
      ))}
    </section>
  ) : <section className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600 shadow-sm">{emptyMessage}</section>;

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <RequireAuth>
          <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-teal-50 via-slate-50 to-amber-50 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Player</p>
                <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">My Fixtures</h1>
                <p className="mt-1 text-sm text-slate-600">Your recent, current, and upcoming fixtures by week.</p>
              </div>
              <PageNav />
            </div>
          </section>

          <section className={cardClass}>
            <div><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">My competition centre</p><h2 className="mt-1 text-xl font-bold text-slate-950">Fixtures, results and tables</h2></div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["weekly", "Weekly view", "Last, this and next week"],
                ["all", "All fixtures", `${allFixtureRows.length} total`],
                ["results", "My results", `${resultRows.length} completed`],
                ["tables", "League tables", `${leagueCompetitions.length} league${leagueCompetitions.length === 1 ? "" : "s"}`],
              ] as Array<[FixtureView, string, string]>).map(([value, label, detail]) => <button key={value} type="button" onClick={() => { setView(value); if (value === "all" || value === "results") { setFixtureCompetitionFilter("all"); setOpponentFilter("all"); } }} className={`rounded-xl border p-3 text-left transition ${view === value ? "border-teal-700 bg-teal-700 text-white shadow-sm" : "border-slate-200 bg-slate-50 text-slate-800 hover:bg-white"}`}><span className="block text-sm font-bold">{label}</span><span className={`mt-1 block text-xs ${view === value ? "text-teal-50" : "text-slate-500"}`}>{detail}</span></button>)}
            </div>
          </section>

          {view === "weekly" ? <section className={cardClass}>
            <p className="text-sm font-semibold text-slate-900">Fixture Window</p>
            <p className="mt-1 text-sm text-slate-600">Switch between last week, this week, and next week to focus on the current playing window.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {([
                ["last", "Last Week"],
                ["this", "This Week"],
                ["next", "Next Week"],
              ] as Array<[WeekFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                    filter === value
                      ? "border-teal-700 bg-teal-700 text-white shadow-sm"
                      : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-white"
                  }`}
                >
                  <span className="block font-semibold">{label}</span>
                  <span className={`mt-1 block text-xs ${filter === value ? "text-teal-50" : "text-slate-500"}`}>
                    {value === "last" ? "Review last week's results and deadlines." : value === "this" ? "Check the current live playing week." : "See the next upcoming fixtures."}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Showing fixtures for <span className="font-semibold text-slate-900">{range.label}</span>
            </div>
          </section> : null}

          {message ? <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900 shadow-sm">{message}</section> : null}

          {linkedPlayerId && (view === "all" || view === "results") ? <section className={cardClass}><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">Filter {view === "results" ? "results" : "fixtures"}</p><p className="mt-1 text-xs text-slate-500">Narrow the list by competition, opponent, or both.</p></div><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-800">{filteredFixtureRows.length} shown</span></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Competition<select value={fixtureCompetitionFilter} onChange={(event) => { setFixtureCompetitionFilter(event.target.value); setOpponentFilter("all"); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="all">All competitions</option>{fixtureCompetitionOptions.map((competition) => <option key={competition.key} value={competition.key}>{competition.name}</option>)}</select></label><label className="text-sm font-medium text-slate-700">Opponent<select value={opponentFilter} onChange={(event) => setOpponentFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="all">All opponents</option>{opponentOptions.map((opponent) => <option key={opponent.id} value={opponent.id}>{opponent.name}</option>)}</select></label></div></section> : null}

          {!linkedPlayerId ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm">
              No linked player profile found for this account yet.
            </section>
          ) : view === "weekly" ? renderFixtureCards(fixtureRows, "No fixtures found for this week selection.")
            : view === "all" ? renderFixtureCards(filteredFixtureRows, fixtureCompetitionFilter !== "all" || opponentFilter !== "all" ? "No fixtures match those filters." : "No fixtures have been published for you yet.")
              : view === "results" ? renderFixtureCards(filteredFixtureRows, fixtureCompetitionFilter !== "all" || opponentFilter !== "all" ? "No results match those filters." : "You do not have any completed results yet.")
                : <section className={cardClass}>
                  <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Live standings</p><h2 className="mt-1 text-xl font-bold text-slate-950">League table</h2></div>{leagueCompetitions.length > 1 ? <label className="text-sm font-medium text-slate-700">Competition<select value={activeLeagueId} onChange={(event) => setSelectedLeagueId(event.target.value)} className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2">{leagueCompetitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}</select></label> : null}</div>
                  {activeLeague ? <><p className="mt-2 font-semibold text-slate-800">{activeLeague.competition.name}</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b-2 border-slate-900 text-left"><th className="p-2">Pos</th><th className="p-2">Player</th><th className="p-2 text-center">P</th><th className="p-2 text-center">W</th><th className="p-2 text-center">L</th><th className="p-2 text-center">Void</th><th className="p-2 text-center">Pts</th></tr></thead><tbody>{activeLeague.table.map((row, index) => <tr key={row.playerId} className={`border-b border-slate-200 ${row.playerId === linkedPlayerId ? "bg-lime-100" : ""}`}><td className="p-2 font-black">{index + 1}</td><td className="p-2 font-semibold">{row.playerName}{row.playerId === linkedPlayerId ? <span className="ml-2 text-xs font-bold text-emerald-800">YOU</span> : null}</td><td className="p-2 text-center">{row.played}</td><td className="p-2 text-center">{row.won}</td><td className="p-2 text-center">{row.lost}</td><td className="p-2 text-center">{row.voided}</td><td className="p-2 text-center text-lg font-black">{row.points}</td></tr>)}</tbody></table></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">Updated {new Date(activeLeague.updatedAt).toLocaleString("en-GB")}</p><Link href={`/league/${activeLeagueId}`} className="rounded-lg border border-teal-300 px-3 py-2 text-sm font-bold text-teal-800">Open full league centre</Link></div></> : <p className="mt-4 text-sm text-slate-600">You are not currently listed in a league competition with a published table.</p>}
                </section>}
        </RequireAuth>
      </div>
    </main>
  );
}
