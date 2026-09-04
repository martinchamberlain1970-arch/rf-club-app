import type { SupabaseClient } from "@supabase/supabase-js";

const AUTO_APPROVAL_NOTE = "Automatically approved because both players submitted the same score.";

type AutoApprovalOptions = {
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
};

type MatchRow = {
  id: string;
  competition_id: string;
  best_of: number;
  status: string;
  match_mode: "singles" | "doubles";
  player1_id: string | null;
  player2_id: string | null;
  rating_applied_at: string | null;
};

type CompetitionRow = {
  id: string;
  name: string;
  sport_type: "snooker" | "pool_8_ball" | "pool_9_ball";
  competition_format: "knockout" | "league";
  is_practice: boolean | null;
};

type SubmissionRow = {
  id: string;
  competition_entry_id: string | null;
  team1_score: number;
  team2_score: number;
  submitted_at: string;
};

type PlayerRatingRow = {
  id: string;
  rating_pool: number | null;
  peak_rating_pool: number | null;
  rated_matches_pool: number | null;
  rating_snooker: number | null;
  peak_rating_snooker: number | null;
  rated_matches_snooker: number | null;
};

function expectedScore(teamA: number, teamB: number) {
  return 1 / (1 + Math.pow(10, (teamB - teamA) / 400));
}

function kFactor(rating: number, matches: number) {
  if (matches < 30) return 32;
  if (rating >= 1800) return 16;
  return 20;
}

async function applyLocalRating(
  client: SupabaseClient,
  match: MatchRow,
  winnerSide: 1 | 2,
  discipline: "pool" | "snooker"
) {
  if (match.rating_applied_at || match.match_mode !== "singles" || !match.player1_id || !match.player2_id) return null;
  const playersResult = await client
    .from("players")
    .select("id,rating_pool,peak_rating_pool,rated_matches_pool,rating_snooker,peak_rating_snooker,rated_matches_snooker")
    .in("id", [match.player1_id, match.player2_id]);
  if (playersResult.error) return playersResult.error.message;
  const players = new Map(((playersResult.data ?? []) as PlayerRatingRow[]).map((player) => [player.id, player]));
  const player1 = players.get(match.player1_id);
  const player2 = players.get(match.player2_id);
  if (!player1 || !player2) return "Player ratings could not be resolved.";

  const ratingKey = discipline === "snooker" ? "rating_snooker" : "rating_pool";
  const peakKey = discipline === "snooker" ? "peak_rating_snooker" : "peak_rating_pool";
  const matchesKey = discipline === "snooker" ? "rated_matches_snooker" : "rated_matches_pool";
  const rating1 = player1[ratingKey] ?? 1000;
  const rating2 = player2[ratingKey] ?? 1000;
  const matches1 = player1[matchesKey] ?? 0;
  const matches2 = player2[matchesKey] ?? 0;
  const delta1 = Math.round(Math.max(kFactor(rating1, matches1), kFactor(rating2, matches2)) * ((winnerSide === 1 ? 1 : 0) - expectedScore(rating1, rating2)));
  const delta2 = -delta1;
  const next1 = Math.max(100, rating1 + delta1);
  const next2 = Math.max(100, rating2 + delta2);
  const expectedTeam1 = expectedScore(rating1, rating2);
  const [update1, update2] = await Promise.all([
    client.from("players").update({ [ratingKey]: next1, [peakKey]: Math.max(player1[peakKey] ?? 1000, next1), [matchesKey]: matches1 + 1 }).eq("id", player1.id),
    client.from("players").update({ [ratingKey]: next2, [peakKey]: Math.max(player2[peakKey] ?? 1000, next2), [matchesKey]: matches2 + 1 }).eq("id", player2.id),
  ]);
  if (update1.error || update2.error) return update1.error?.message || update2.error?.message || "Ratings could not be updated.";
  const mark = await client
    .from("matches")
    .update({
      rating_applied_at: new Date().toISOString(),
      rating_delta_team1: delta1,
      rating_delta_team2: delta2,
      elo_team1_before: rating1,
      elo_team2_before: rating2,
      elo_team1_after: next1,
      elo_team2_after: next2,
      expected_team1_probability: expectedTeam1,
    })
    .eq("id", match.id)
    .is("rating_applied_at", null);
  return mark.error?.message ?? null;
}

export async function tryAutoApproveMatchingResult(client: SupabaseClient, matchId: string, options: AutoApprovalOptions = {}) {
  const matchResult = await client
    .from("matches")
    .select("id,competition_id,best_of,status,match_mode,player1_id,player2_id,rating_applied_at")
    .eq("id", matchId)
    .maybeSingle();
  if (matchResult.error || !matchResult.data) return { autoApproved: false, error: matchResult.error?.message ?? "Match not found." };
  const match = matchResult.data as MatchRow;
  if (match.status === "complete" || match.match_mode !== "singles" || !match.player1_id || !match.player2_id) return { autoApproved: false };

  const competitionResult = await client
    .from("competitions")
    .select("id,name,sport_type,competition_format,is_practice")
    .eq("id", match.competition_id)
    .maybeSingle();
  if (competitionResult.error || !competitionResult.data) return { autoApproved: false, error: competitionResult.error?.message ?? "Competition not found." };
  const competition = competitionResult.data as CompetitionRow;
  if (competition.competition_format !== "league") return { autoApproved: false };

  const submissionsResult = await client
    .from("result_submissions")
    .select("id,competition_entry_id,team1_score,team2_score,submitted_at")
    .eq("match_id", match.id)
    .eq("status", "pending")
    .order("submitted_at", { ascending: false });
  if (submissionsResult.error) return { autoApproved: false, error: submissionsResult.error.message };
  const latestByEntry = new Map<string, SubmissionRow>();
  for (const submission of (submissionsResult.data ?? []) as SubmissionRow[]) {
    if (submission.competition_entry_id && !latestByEntry.has(submission.competition_entry_id)) latestByEntry.set(submission.competition_entry_id, submission);
  }
  if (latestByEntry.size < 2) return { autoApproved: false, reason: "waiting_for_opponent" };

  const entryIds = [...latestByEntry.keys()];
  const entriesResult = await client.from("competition_entries").select("id,player_id").in("id", entryIds);
  if (entriesResult.error) return { autoApproved: false, error: entriesResult.error.message };
  const entryByPlayer = new Map((entriesResult.data ?? []).map((entry) => [entry.player_id, entry.id]));
  const submission1 = latestByEntry.get(entryByPlayer.get(match.player1_id) ?? "");
  const submission2 = latestByEntry.get(entryByPlayer.get(match.player2_id) ?? "");
  if (!submission1 || !submission2) return { autoApproved: false, reason: "waiting_for_opponent" };
  if (submission1.team1_score !== submission2.team1_score || submission1.team2_score !== submission2.team2_score) {
    return { autoApproved: false, reason: "scores_disputed" };
  }

  const team1Score = submission1.team1_score;
  const team2Score = submission1.team2_score;
  const fixedRackLeague = competition.sport_type !== "snooker";
  const target = Math.floor(match.best_of / 2) + 1;
  const valid = fixedRackLeague
    ? team1Score + team2Score === match.best_of && team1Score !== team2Score
    : (team1Score >= target || team2Score >= target) && team1Score !== team2Score;
  if (!valid) return { autoApproved: false, reason: "invalid_score" };

  const reviewedAt = new Date().toISOString();
  const submissionIds = [submission1.id, submission2.id];
  const approve = await client.from("result_submissions").update({
    status: "approved",
    reviewed_by_user_id: null,
    reviewed_at: reviewedAt,
    note: AUTO_APPROVAL_NOTE,
  }).in("id", submissionIds).eq("status", "pending");
  if (approve.error) return { autoApproved: false, error: approve.error.message };

  const winnerSide: 1 | 2 = team1Score > team2Score ? 1 : 2;
  const winnerId = winnerSide === 1 ? match.player1_id : match.player2_id;
  const claim = await client.from("matches").update({ status: "complete", winner_player_id: winnerId })
    .eq("id", match.id)
    .in("status", ["pending", "in_progress"])
    .select("id")
    .maybeSingle();
  if (claim.error) return { autoApproved: false, error: claim.error.message };

  let ratingWarning: string | null = null;
  if (claim.data && !competition.is_practice) {
    ratingWarning = await applyLocalRating(
      client,
      match,
      winnerSide,
      competition.sport_type === "snooker" ? "snooker" : "pool"
    );
  }
  if (claim.data) {
    const remaining = await client.from("matches").select("id", { count: "exact", head: true })
      .eq("competition_id", match.competition_id).eq("is_archived", false).not("status", "in", "(complete,bye)");
    if (!remaining.error) await client.from("competitions").update({ is_completed: (remaining.count ?? 0) === 0 }).eq("id", match.competition_id);
    await client.from("audit_logs").insert({
      actor_user_id: options.actorUserId ?? null,
      actor_email: options.actorEmail ?? null,
      actor_role: options.actorRole ?? "user",
      action: "result_auto_approved",
      entity_type: "match",
      entity_id: match.id,
      summary: `Both players agreed ${team1Score}-${team2Score}; result automatically approved.`,
      meta: { competitionId: match.competition_id, submissionIds, team1Score, team2Score, ratingWarning },
    });
  }
  return { autoApproved: true, team1Score, team2Score, winnerSide, ratingWarning };
}

export { AUTO_APPROVAL_NOTE };
