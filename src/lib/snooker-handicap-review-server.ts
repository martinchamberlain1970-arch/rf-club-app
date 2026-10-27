import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateSnookerHandicapStarts, targetSnookerHandicapFromElo } from "@/lib/snooker-handicap";

type PlayerRow = {
  id: string;
  rating_snooker: number | null;
  snooker_handicap: number | null;
  snooker_handicap_base: number | null;
};

type ReviewOptions = {
  playerId?: string | null;
  effectiveFrom: string;
  reason: string;
  changedBy?: string | null;
};

export function targetHandicapFromElo(rating: number) {
  return targetSnookerHandicapFromElo(rating);
}

export function currentLondonDate(from = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(from);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function nextSnookerHandicapReviewDate(lastReviewedAt: string | Date, intervalDays = 28) {
  const intervalEnd = addCalendarDays(currentLondonDate(new Date(lastReviewedAt)), intervalDays);
  const weekday = new Date(`${intervalEnd}T12:00:00Z`).getUTCDay();
  const daysUntilSunday = (7 - weekday) % 7;
  return addCalendarDays(intervalEnd, daysUntilSunday);
}

export function scheduledSnookerHandicapReviewDate(row: { created_at: string; meta?: unknown }) {
  const meta = row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : null;
  // Older audits used effectiveFrom for the following fixture Monday, not for
  // the date on which the review occurred. Only new audits have an explicit
  // scheduledReviewDate; legacy rows must remain anchored to created_at.
  const scheduledReviewDate = typeof meta?.scheduledReviewDate === "string" ? meta.scheduledReviewDate : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(scheduledReviewDate)
    ? scheduledReviewDate
    : currentLondonDate(new Date(row.created_at));
}

export async function runSnookerHandicapReview(client: SupabaseClient, options: ReviewOptions) {
  let playerQuery = client
    .from("players")
    .select("id,rating_snooker,snooker_handicap,snooker_handicap_base")
    .eq("is_archived", false);
  if (options.playerId) playerQuery = playerQuery.eq("id", options.playerId);
  const playerResult = await playerQuery;
  if (playerResult.error) throw new Error(playerResult.error.message);
  const reviewedPlayers = (playerResult.data ?? []) as PlayerRow[];
  if (options.playerId && reviewedPlayers.length !== 1) throw new Error("Player not found.");

  const historyRows: Array<{
    player_id: string;
    previous_handicap: number;
    new_handicap: number;
    delta: number;
    reason: string;
    changed_by: string | null;
    fixture_id: null;
  }> = [];

  for (const player of reviewedPlayers) {
    const target = targetHandicapFromElo(Math.round(player.rating_snooker ?? 1000));
    const previous = player.snooker_handicap ?? player.snooker_handicap_base ?? target;
    const update = await client
      .from("players")
      .update({
        snooker_handicap: target,
        snooker_handicap_base: player.snooker_handicap_base ?? target,
      })
      .eq("id", player.id);
    if (update.error) throw new Error(update.error.message);
    if (target !== previous) {
      historyRows.push({
        player_id: player.id,
        previous_handicap: previous,
        new_handicap: target,
        delta: target - previous,
        reason: options.reason,
        changed_by: options.changedBy ?? null,
        fixture_id: null,
      });
    }
  }

  if (historyRows.length) {
    const historyResult = await client.from("snooker_handicap_history").insert(historyRows);
    if (historyResult.error) throw new Error(historyResult.error.message);
  }

  const competitionResult = await client
    .from("competitions")
    .select("id")
    .eq("sport_type", "snooker")
    .eq("handicap_enabled", true)
    .eq("is_archived", false)
    .eq("is_completed", false);
  if (competitionResult.error) throw new Error(competitionResult.error.message);
  const competitionIds = (competitionResult.data ?? []).map((competition) => competition.id as string);
  if (!competitionIds.length) {
    return { reviewedPlayers: reviewedPlayers.length, changedPlayers: historyRows.length, refreshedFixtures: 0 };
  }

  let matchQuery = client
    .from("matches")
    .select("id,player1_id,player2_id")
    .in("competition_id", competitionIds)
    .eq("is_archived", false)
    .eq("status", "pending")
    .gte("scheduled_for", options.effectiveFrom)
    .not("player1_id", "is", null)
    .not("player2_id", "is", null);
  if (options.playerId) matchQuery = matchQuery.or(`player1_id.eq.${options.playerId},player2_id.eq.${options.playerId}`);
  const matchResult = await matchQuery;
  if (matchResult.error) throw new Error(matchResult.error.message);
  const matches = (matchResult.data ?? []) as Array<{ id: string; player1_id: string; player2_id: string }>;
  const participantIds = [...new Set(matches.flatMap((match) => [match.player1_id, match.player2_id]))];
  const handicapResult = participantIds.length
    ? await client.from("players").select("id,snooker_handicap").in("id", participantIds)
    : { data: [], error: null };
  if (handicapResult.error) throw new Error(handicapResult.error.message);
  const handicapByPlayer = new Map((handicapResult.data ?? []).map((player) => [player.id as string, Number(player.snooker_handicap ?? 0)]));
  for (const match of matches) {
    if (match.player1_id === match.player2_id) continue;
    const starts = calculateSnookerHandicapStarts(handicapByPlayer.get(match.player1_id), handicapByPlayer.get(match.player2_id));
    const update = await client
      .from("matches")
      .update({ team1_handicap_start: starts.team1, team2_handicap_start: starts.team2 })
      .eq("id", match.id);
    if (update.error) throw new Error(update.error.message);
  }

  return {
    reviewedPlayers: reviewedPlayers.length,
    changedPlayers: historyRows.length,
    refreshedFixtures: matches.filter((match) => match.player1_id !== match.player2_id).length,
  };
}
