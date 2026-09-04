import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!supabaseUrl || !serviceRoleKey || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "League not found." }, { status: 404 });
  }
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const competitionResult = await client
    .from("competitions")
    .select("id,name,venue,sport_type,competition_format,best_of,league_schedule_mode,league_meetings,league_finals_size")
    .eq("id", id)
    .maybeSingle();
  const competition = competitionResult.data;
  if (competitionResult.error || !competition || competition.competition_format !== "league") {
    return NextResponse.json({ error: "This public league page is not available." }, { status: 404 });
  }

  const [entriesResult, matchesResult] = await Promise.all([
    client.from("competition_entries").select("player_id").eq("competition_id", id).eq("status", "approved"),
    client
      .from("matches")
      .select("id,round_no,match_no,best_of,status,player1_id,player2_id,winner_player_id,opening_break_player_id,scheduled_for")
      .eq("competition_id", id)
      .eq("is_archived", false)
      .order("round_no")
      .order("match_no"),
  ]);
  if (entriesResult.error || matchesResult.error) {
    return NextResponse.json({ error: entriesResult.error?.message || matchesResult.error?.message }, { status: 400 });
  }
  const playerIds = [...new Set((entriesResult.data ?? []).map((entry) => entry.player_id).filter(Boolean))];
  const matchIds = (matchesResult.data ?? []).map((match) => match.id);
  const [playersResult, framesResult, reschedulesResult] = await Promise.all([
    playerIds.length
      ? client.from("players").select("id,display_name,full_name").in("id", playerIds)
      : Promise.resolve({ data: [], error: null }),
    matchIds.length
      ? client.from("frames").select("match_id,winner_player_id,is_walkover_award,team1_points,team2_points").in("match_id", matchIds)
      : Promise.resolve({ data: [], error: null }),
    matchIds.length
      ? client
          .from("league_reschedule_requests")
          .select("match_id,original_scheduled_for,requested_scheduled_for")
          .in("match_id", matchIds)
          .eq("status", "approved")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (playersResult.error || framesResult.error || reschedulesResult.error) {
    return NextResponse.json({ error: playersResult.error?.message || framesResult.error?.message || reschedulesResult.error?.message }, { status: 400 });
  }

  const nameById = new Map((playersResult.data ?? []).map((player) => [player.id, player.full_name?.trim() || player.display_name]));
  const entrantCount = playerIds.length;
  const meetings = Math.max(1, Number(competition.league_meetings ?? 1));
  const roundRobinRoundCount = (entrantCount % 2 === 0 ? Math.max(1, entrantCount - 1) : entrantCount) * meetings;
  const leagueMatches = (matchesResult.data ?? []).filter((match) => (
    competition.league_schedule_mode !== "one_day" || (match.round_no ?? 1) <= roundRobinRoundCount
  ));
  const framesByMatch = new Map<string, Array<{ winner_player_id: string | null; is_walkover_award: boolean; team1_points: number | null; team2_points: number | null }>>();
  for (const frame of framesResult.data ?? []) {
    framesByMatch.set(frame.match_id, [...(framesByMatch.get(frame.match_id) ?? []), frame]);
  }

  const stats = new Map<string, { playerId: string; playerName: string; played: number; won: number; lost: number; voided: number; points: number; pointsFor: number; pointsAgainst: number }>();
  for (const playerId of playerIds) {
    stats.set(playerId, { playerId, playerName: nameById.get(playerId) || "Player", played: 0, won: 0, lost: 0, voided: 0, points: 0, pointsFor: 0, pointsAgainst: 0 });
  }
  for (const match of leagueMatches) {
    if (match.status !== "complete" || !match.player1_id || !match.player2_id || match.player1_id === match.player2_id) continue;
    const player1 = stats.get(match.player1_id);
    const player2 = stats.get(match.player2_id);
    if (!player1 || !player2) continue;
    player1.played += 1;
    player2.played += 1;
    const frames = framesByMatch.get(match.id) ?? [];
    let player1Score = frames.filter((frame) => frame.winner_player_id === match.player1_id).length;
    let player2Score = frames.filter((frame) => frame.winner_player_id === match.player2_id).length;
    if (!frames.length && match.winner_player_id) {
      player1Score = match.winner_player_id === match.player1_id ? 1 : 0;
      player2Score = match.winner_player_id === match.player2_id ? 1 : 0;
    }
    player1.points += player1Score;
    player2.points += player2Score;
    const player1PointsFor = competition.sport_type === "snooker"
      ? frames.reduce((total, frame) => total + Number(frame.team1_points ?? 0), 0)
      : player1Score;
    const player2PointsFor = competition.sport_type === "snooker"
      ? frames.reduce((total, frame) => total + Number(frame.team2_points ?? 0), 0)
      : player2Score;
    player1.pointsFor += player1PointsFor;
    player1.pointsAgainst += player2PointsFor;
    player2.pointsFor += player2PointsFor;
    player2.pointsAgainst += player1PointsFor;
    if (!match.winner_player_id) {
      player1.voided += 1;
      player2.voided += 1;
    } else if (match.winner_player_id === match.player1_id) {
      player1.won += 1;
      player2.lost += 1;
    } else if (match.winner_player_id === match.player2_id) {
      player2.won += 1;
      player1.lost += 1;
    }
  }

  const table = [...stats.values()]
    .map((row) => ({ ...row, pointsDifference: row.pointsFor - row.pointsAgainst }))
    .sort((a, b) => b.points - a.points || b.pointsDifference - a.pointsDifference || b.pointsFor - a.pointsFor || b.won - a.won || a.lost - b.lost || a.playerName.localeCompare(b.playerName));
  const approvedRescheduleByMatch = new Map(
    (reschedulesResult.data ?? []).map((request) => [request.match_id, request])
  );
  const weekByScheduledDate = new Map<string, number>();
  for (const match of leagueMatches) {
    if (!match.scheduled_for || approvedRescheduleByMatch.has(match.id)) continue;
    if (!weekByScheduledDate.has(match.scheduled_for)) weekByScheduledDate.set(match.scheduled_for, match.round_no ?? 1);
  }
  const activeFixtures = leagueMatches.map((match) => {
    const frames = framesByMatch.get(match.id) ?? [];
    const player1Score = competition.sport_type === "snooker"
      ? frames.reduce((total, frame) => total + Number(frame.team1_points ?? 0), 0)
      : frames.filter((frame) => frame.winner_player_id === match.player1_id).length;
    const player2Score = competition.sport_type === "snooker"
      ? frames.reduce((total, frame) => total + Number(frame.team2_points ?? 0), 0)
      : frames.filter((frame) => frame.winner_player_id === match.player2_id).length;
    const isBye = match.status === "bye" || Boolean(match.player1_id && match.player1_id === match.player2_id);
    const reschedule = approvedRescheduleByMatch.get(match.id);
    const dayDifference = reschedule
      ? Math.round((new Date(`${reschedule.requested_scheduled_for}T12:00:00`).getTime() - new Date(`${reschedule.original_scheduled_for}T12:00:00`).getTime()) / 86_400_000)
      : 0;
    const displayedWeek = reschedule
      ? weekByScheduledDate.get(reschedule.requested_scheduled_for) ?? Math.max(1, (match.round_no ?? 1) + Math.round(dayDifference / 7))
      : match.round_no ?? 1;
    return {
      id: match.id,
      sourceMatchId: match.id,
      week: displayedWeek,
      originalWeek: match.round_no ?? 1,
      matchNo: match.match_no ?? 1,
      bestOf: match.best_of,
      status: match.status,
      scheduledFor: match.scheduled_for,
      player1: nameById.get(match.player1_id ?? "") || "TBC",
      player2: isBye ? "BYE" : nameById.get(match.player2_id ?? "") || "TBC",
      openingBreaker: isBye ? null : nameById.get(match.opening_break_player_id ?? "") || null,
      score: match.status === "complete" && !isBye ? { player1: player1Score, player2: player2Score, void: !match.winner_player_id } : null,
      isReschedulePlaceholder: false,
      rescheduledFrom: reschedule?.original_scheduled_for ?? null,
      rescheduledTo: reschedule?.requested_scheduled_for ?? null,
    };
  });
  const reschedulePlaceholders = activeFixtures
    .filter((fixture) => fixture.rescheduledFrom && fixture.rescheduledTo)
    .map((fixture) => ({
      ...fixture,
      id: `${fixture.id}:original`,
      week: fixture.originalWeek,
      status: "rescheduled",
      scheduledFor: fixture.rescheduledFrom,
      openingBreaker: null,
      score: null,
      isReschedulePlaceholder: true,
    }));
  const fixtures = [...activeFixtures, ...reschedulePlaceholders]
    .sort((a, b) => a.week - b.week || a.matchNo - b.matchNo || Number(a.isReschedulePlaceholder) - Number(b.isReschedulePlaceholder));
  return NextResponse.json({ competition, fixtures, table, updatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}
