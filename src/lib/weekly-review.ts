import type { SupabaseClient } from "@supabase/supabase-js";

export type WeeklyReviewResult = {
  matchId: string;
  week: number;
  player1Id: string;
  player2Id: string;
  player1: string;
  player2: string;
  score1: number;
  score2: number;
  voided: boolean;
  elo1Before: number;
  elo2Before: number;
  elo1After: number;
  elo2After: number;
  eloDelta1: number;
  eloDelta2: number;
  expected1Pct: number;
  expected2Pct: number;
  expectedFavourite: string;
  actualWinner: string | null;
  upset: boolean;
  estimatedExpectation: boolean;
};

export type WeeklyReviewData = {
  competition: { id: string; name: string; venue: string | null; sportType: string };
  weekStart: string;
  weekEnd: string;
  weekNumbers: number[];
  generatedAt: string;
  totalFixtures: number;
  completedFixtures: number;
  voidFixtures: number;
  unresolvedFixtures: number;
  allResolved: boolean;
  results: WeeklyReviewResult[];
  eloMovers: Array<{ playerId: string; playerName: string; change: number }>;
  biggestUpset: WeeklyReviewResult | null;
  table: Array<{ position: number; previousPosition: number | null; movement: number | null; playerId: string; playerName: string; played: number; won: number; lost: number; voided: number; points: number }>;
};

type MatchRow = {
  id: string;
  round_no: number | null;
  status: string;
  scheduled_for: string | null;
  player1_id: string | null;
  player2_id: string | null;
  winner_player_id: string | null;
  rating_delta_team1: number | null;
  rating_delta_team2: number | null;
  elo_team1_before: number | null;
  elo_team2_before: number | null;
  elo_team1_after: number | null;
  elo_team2_after: number | null;
  expected_team1_probability: number | null;
};

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function expectedScore(team1: number, team2: number) {
  return 1 / (1 + Math.pow(10, (team2 - team1) / 400));
}

function buildTable(
  playerIds: string[],
  nameById: Map<string, string>,
  matches: MatchRow[],
  framesByMatch: Map<string, Array<{ winner_player_id: string | null }>>
) {
  const stats = new Map(playerIds.map((playerId) => [playerId, { playerId, playerName: nameById.get(playerId) ?? "Player", played: 0, won: 0, lost: 0, voided: 0, points: 0 }]));
  for (const match of matches) {
    if (match.status !== "complete" || !match.player1_id || !match.player2_id || match.player1_id === match.player2_id) continue;
    const player1 = stats.get(match.player1_id);
    const player2 = stats.get(match.player2_id);
    if (!player1 || !player2) continue;
    player1.played += 1;
    player2.played += 1;
    const frames = framesByMatch.get(match.id) ?? [];
    player1.points += frames.filter((frame) => frame.winner_player_id === match.player1_id).length;
    player2.points += frames.filter((frame) => frame.winner_player_id === match.player2_id).length;
    if (!match.winner_player_id) {
      player1.voided += 1;
      player2.voided += 1;
    } else if (match.winner_player_id === match.player1_id) {
      player1.won += 1;
      player2.lost += 1;
    } else {
      player2.won += 1;
      player1.lost += 1;
    }
  }
  return [...stats.values()].sort((a, b) => b.points - a.points || b.won - a.won || a.lost - b.lost || a.playerName.localeCompare(b.playerName));
}

export async function buildWeeklyReview(client: SupabaseClient, competitionId: string, weekStart: string): Promise<WeeklyReviewData> {
  const weekEnd = addDays(weekStart, 6);
  const competitionResult = await client.from("competitions").select("id,name,venue,sport_type,competition_format").eq("id", competitionId).maybeSingle();
  if (competitionResult.error || !competitionResult.data || competitionResult.data.competition_format !== "league") throw new Error(competitionResult.error?.message ?? "League competition not found.");
  const competition = competitionResult.data;
  const [entriesResult, matchesResult] = await Promise.all([
    client.from("competition_entries").select("player_id").eq("competition_id", competitionId).eq("status", "approved"),
    client.from("matches").select("id,round_no,status,scheduled_for,player1_id,player2_id,winner_player_id,rating_delta_team1,rating_delta_team2,elo_team1_before,elo_team2_before,elo_team1_after,elo_team2_after,expected_team1_probability").eq("competition_id", competitionId).eq("is_archived", false).order("scheduled_for"),
  ]);
  if (entriesResult.error || matchesResult.error) throw new Error(entriesResult.error?.message || matchesResult.error?.message || "Weekly review data could not be loaded.");
  const matches = (matchesResult.data ?? []) as MatchRow[];
  const playerIds = [...new Set((entriesResult.data ?? []).map((entry) => entry.player_id).filter(Boolean))] as string[];
  const matchIds = matches.map((match) => match.id);
  const [playersResult, framesResult] = await Promise.all([
    playerIds.length ? client.from("players").select("id,display_name,full_name,rating_pool,rating_snooker").in("id", playerIds) : Promise.resolve({ data: [], error: null }),
    matchIds.length ? client.from("frames").select("match_id,winner_player_id,is_walkover_award").in("match_id", matchIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (playersResult.error || framesResult.error) throw new Error(playersResult.error?.message || framesResult.error?.message || "Weekly review details could not be loaded.");
  const players = playersResult.data ?? [];
  const nameById = new Map(players.map((player) => [player.id, player.full_name?.trim() || player.display_name]));
  const currentRatingById = new Map(players.map((player) => [player.id, Number(competition.sport_type === "snooker" ? player.rating_snooker ?? 1000 : player.rating_pool ?? 1000)]));
  const framesByMatch = new Map<string, Array<{ winner_player_id: string | null }>>();
  for (const frame of framesResult.data ?? []) {
    if (frame.is_walkover_award) continue;
    framesByMatch.set(frame.match_id, [...(framesByMatch.get(frame.match_id) ?? []), { winner_player_id: frame.winner_player_id }]);
  }

  const weekMatches = matches.filter((match) => Boolean(match.scheduled_for && match.scheduled_for >= weekStart && match.scheduled_for <= weekEnd && match.player1_id !== match.player2_id));
  const completed = weekMatches.filter((match) => match.status === "complete");
  const results: WeeklyReviewResult[] = completed.flatMap((match) => {
    if (!match.player1_id || !match.player2_id) return [];
    const frames = framesByMatch.get(match.id) ?? [];
    const score1 = frames.filter((frame) => frame.winner_player_id === match.player1_id).length;
    const score2 = frames.filter((frame) => frame.winner_player_id === match.player2_id).length;
    const delta1 = Number(match.rating_delta_team1 ?? 0);
    const delta2 = Number(match.rating_delta_team2 ?? 0);
    const current1 = currentRatingById.get(match.player1_id) ?? 1000;
    const current2 = currentRatingById.get(match.player2_id) ?? 1000;
    const estimatedExpectation = match.elo_team1_before == null || match.elo_team2_before == null || match.expected_team1_probability == null;
    const before1 = Number(match.elo_team1_before ?? current1 - delta1);
    const before2 = Number(match.elo_team2_before ?? current2 - delta2);
    const after1 = Number(match.elo_team1_after ?? before1 + delta1);
    const after2 = Number(match.elo_team2_after ?? before2 + delta2);
    const expected1 = Number(match.expected_team1_probability ?? expectedScore(before1, before2));
    const player1 = nameById.get(match.player1_id) ?? "Player 1";
    const player2 = nameById.get(match.player2_id) ?? "Player 2";
    const actualWinner = match.winner_player_id === match.player1_id ? player1 : match.winner_player_id === match.player2_id ? player2 : null;
    const winnerExpected = match.winner_player_id === match.player1_id ? expected1 : match.winner_player_id === match.player2_id ? 1 - expected1 : 0.5;
    return [{
      matchId: match.id,
      week: match.round_no ?? 1,
      player1Id: match.player1_id,
      player2Id: match.player2_id,
      player1,
      player2,
      score1,
      score2,
      voided: !match.winner_player_id,
      elo1Before: Math.round(before1),
      elo2Before: Math.round(before2),
      elo1After: Math.round(after1),
      elo2After: Math.round(after2),
      eloDelta1: delta1,
      eloDelta2: delta2,
      expected1Pct: Math.round(expected1 * 100),
      expected2Pct: Math.round((1 - expected1) * 100),
      expectedFavourite: expected1 >= 0.5 ? player1 : player2,
      actualWinner,
      upset: Boolean(actualWinner && winnerExpected < 0.5),
      estimatedExpectation,
    }];
  });

  const moverMap = new Map<string, { playerId: string; playerName: string; change: number }>();
  for (const result of results) {
    moverMap.set(result.player1Id, { playerId: result.player1Id, playerName: result.player1, change: (moverMap.get(result.player1Id)?.change ?? 0) + result.eloDelta1 });
    moverMap.set(result.player2Id, { playerId: result.player2Id, playerName: result.player2, change: (moverMap.get(result.player2Id)?.change ?? 0) + result.eloDelta2 });
  }
  const eloMovers = [...moverMap.values()].sort((a, b) => b.change - a.change || a.playerName.localeCompare(b.playerName));
  const upsetResults = results.filter((result) => result.upset);
  const biggestUpset = upsetResults.sort((a, b) => {
    const aWinnerExpected = a.actualWinner === a.player1 ? a.expected1Pct : a.expected2Pct;
    const bWinnerExpected = b.actualWinner === b.player1 ? b.expected1Pct : b.expected2Pct;
    return aWinnerExpected - bWinnerExpected;
  })[0] ?? null;

  const beforeMatches = matches.filter((match) => Boolean(match.scheduled_for && match.scheduled_for < weekStart));
  const throughMatches = matches.filter((match) => Boolean(match.scheduled_for && match.scheduled_for <= weekEnd));
  const beforeTable = buildTable(playerIds, nameById, beforeMatches, framesByMatch);
  const throughTable = buildTable(playerIds, nameById, throughMatches, framesByMatch);
  const previousPosition = new Map(beforeTable.map((row, index) => [row.playerId, index + 1]));
  const table = throughTable.map((row, index) => {
    const prior = previousPosition.get(row.playerId) ?? null;
    return { ...row, position: index + 1, previousPosition: prior, movement: prior == null ? null : prior - (index + 1) };
  });

  return {
    competition: { id: competition.id, name: competition.name, venue: competition.venue, sportType: competition.sport_type },
    weekStart,
    weekEnd,
    weekNumbers: [...new Set(weekMatches.map((match) => match.round_no ?? 1))].sort((a, b) => a - b),
    generatedAt: new Date().toISOString(),
    totalFixtures: weekMatches.length,
    completedFixtures: completed.length,
    voidFixtures: completed.filter((match) => !match.winner_player_id).length,
    unresolvedFixtures: weekMatches.filter((match) => !["complete", "bye"].includes(match.status)).length,
    allResolved: weekMatches.length > 0 && weekMatches.every((match) => ["complete", "bye"].includes(match.status)),
    results,
    eloMovers,
    biggestUpset,
    table,
  };
}
