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

async function applyPoolRating(client: SupabaseClient, match: MatchRow, winnerSide: 1 | 2) {
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

  const rating1 = player1.rating_pool ?? 1000;
  const rating2 = player2.rating_pool ?? 1000;
  const matches1 = player1.rated_matches_pool ?? 0;
  const matches2 = player2.rated_matches_pool ?? 0;
  const delta1 = Math.round(Math.max(kFactor(rating1, matches1), kFactor(rating2, matches2)) * ((winnerSide === 1 ? 1 : 0) - expectedScore(rating1, rating2)));
  const delta2 = -delta1;
  const next1 = Math.max(100, rating1 + delta1);
  const next2 = Math.max(100, rating2 + delta2);
  const expectedTeam1 = expectedScore(rating1, rating2);
  const [update1, update2] = await Promise.all([
    client.from("players").update({ rating_pool: next1, peak_rating_pool: Math.max(player1.peak_rating_pool ?? 1000, next1), rated_matches_pool: matches1 + 1 }).eq("id", player1.id),
    client.from("players").update({ rating_pool: next2, peak_rating_pool: Math.max(player2.peak_rating_pool ?? 1000, next2), rated_matches_pool: matches2 + 1 }).eq("id", player2.id),
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

async function applySnookerRating(client: SupabaseClient, match: MatchRow, competition: CompetitionRow, winnerSide: 1 | 2) {
  if (match.rating_applied_at || match.match_mode !== "singles" || !match.player1_id || !match.player2_id) return null;
  const sharedKey = process.env.SHARED_RATING_API_KEY?.trim() ?? "";
  const sharedUrl = process.env.LEAGUE_SHARED_RATING_URL?.trim() ?? "https://rf-league-app.vercel.app/api/rating/apply-snooker-result";
  if (!sharedKey) return "Shared snooker rating sync is not configured.";
  const winnerId = winnerSide === 1 ? match.player1_id : match.player2_id;
  const loserId = winnerSide === 1 ? match.player2_id : match.player1_id;
  const response = await fetch(sharedUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-shared-rating-key": sharedKey },
    body: JSON.stringify({
      source_app: "club",
      source_result_id: `club-match:${match.id}`,
      winner_source_player_id: winnerId,
      loser_source_player_id: loserId,
      winner_score: 1,
      loser_score: 0,
      notes: `Club match ${match.id} (${competition.name})`,
      metadata: { competition_id: match.competition_id, match_id: match.id },
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; delta_winner?: number; delta_loser?: number };
  if (!response.ok || !payload.ok) return payload.error ?? "Shared snooker rating sync failed.";

  const playersResult = await client
    .from("players")
    .select("id,rating_pool,peak_rating_pool,rated_matches_pool,rating_snooker,peak_rating_snooker,rated_matches_snooker")
    .in("id", [winnerId, loserId]);
  if (playersResult.error) return playersResult.error.message;
  const players = new Map(((playersResult.data ?? []) as PlayerRatingRow[]).map((player) => [player.id, player]));
  const winner = players.get(winnerId);
  const loser = players.get(loserId);
  const winnerDelta = Number(payload.delta_winner ?? 0);
  const loserDelta = Number(payload.delta_loser ?? 0);
  const player1 = players.get(match.player1_id);
  const player2 = players.get(match.player2_id);
  const rating1Before = player1?.rating_snooker ?? 1000;
  const rating2Before = player2?.rating_snooker ?? 1000;
  if (winner) {
    const current = winner.rating_snooker ?? 1000;
    const next = Math.max(100, current + winnerDelta);
    const update = await client.from("players").update({ rating_snooker: next, peak_rating_snooker: Math.max(winner.peak_rating_snooker ?? 1000, next), rated_matches_snooker: (winner.rated_matches_snooker ?? 0) + 1 }).eq("id", winner.id);
    if (update.error) return update.error.message;
  }
  if (loser) {
    const current = loser.rating_snooker ?? 1000;
    const next = Math.max(100, current + loserDelta);
    const update = await client.from("players").update({ rating_snooker: next, peak_rating_snooker: Math.max(loser.peak_rating_snooker ?? 1000, next), rated_matches_snooker: (loser.rated_matches_snooker ?? 0) + 1 }).eq("id", loser.id);
    if (update.error) return update.error.message;
  }
  const mark = await client.from("matches").update({
    rating_applied_at: new Date().toISOString(),
    rating_delta_team1: winnerSide === 1 ? winnerDelta : loserDelta,
    rating_delta_team2: winnerSide === 2 ? winnerDelta : loserDelta,
    elo_team1_before: rating1Before,
    elo_team2_before: rating2Before,
    elo_team1_after: Math.max(100, rating1Before + (winnerSide === 1 ? winnerDelta : loserDelta)),
    elo_team2_after: Math.max(100, rating2Before + (winnerSide === 2 ? winnerDelta : loserDelta)),
    expected_team1_probability: expectedScore(rating1Before, rating2Before),
  }).eq("id", match.id).is("rating_applied_at", null);
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
    ratingWarning = competition.sport_type === "snooker"
      ? await applySnookerRating(client, match, competition, winnerSide)
      : await applyPoolRating(client, match, winnerSide);
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
