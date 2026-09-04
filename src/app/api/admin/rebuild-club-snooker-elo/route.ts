import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail =
  process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  "";

type PlayerRow = {
  id: string;
  rating_snooker: number | null;
  snooker_handicap: number | null;
  snooker_handicap_base: number | null;
};

type MatchRow = {
  id: string;
  player1_id: string;
  player2_id: string;
  winner_player_id: string;
  updated_at: string | null;
};

function expectedScore(player: number, opponent: number) {
  return 1 / (1 + Math.pow(10, (opponent - player) / 400));
}

function kFactor(rating: number, matches: number) {
  if (matches < 30) return 32;
  if (rating >= 1800) return 16;
  return 20;
}

function seedRating(player: PlayerRow) {
  const handicap = player.snooker_handicap_base ?? player.snooker_handicap;
  if (handicap === null) return 1000;
  return Math.max(100, Math.round(1000 - handicap * 5));
}

export async function POST(req: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const authResult = await authClient.auth.getUser(token);
  const user = authResult.data.user;
  if (authResult.error || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!superAdminEmail || user.email?.trim().toLowerCase() !== superAdminEmail) {
    return NextResponse.json({ error: "Super User only." }, { status: 403 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const [competitionResult, playerResult] = await Promise.all([
    admin.from("competitions").select("id,is_practice").eq("sport_type", "snooker"),
    admin
      .from("players")
      .select("id,rating_snooker,snooker_handicap,snooker_handicap_base")
      .eq("is_archived", false),
  ]);
  if (competitionResult.error || playerResult.error) {
    return NextResponse.json(
      { error: competitionResult.error?.message ?? playerResult.error?.message ?? "Unable to load club rating data." },
      { status: 400 }
    );
  }

  const competitionIds = (competitionResult.data ?? [])
    .filter((competition) => !competition.is_practice)
    .map((competition) => competition.id as string);
  if (!competitionIds.length) return NextResponse.json({ ok: true, matches: 0, rankedPlayers: 0 });

  const [matchResult, walkoverResult] = await Promise.all([
    admin
      .from("matches")
      .select("id,player1_id,player2_id,winner_player_id,updated_at")
      .in("competition_id", competitionIds)
      .eq("status", "complete")
      .eq("match_mode", "singles")
      .not("player1_id", "is", null)
      .not("player2_id", "is", null)
      .not("winner_player_id", "is", null)
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true }),
    admin.from("frames").select("match_id").eq("is_walkover_award", true),
  ]);
  if (matchResult.error || walkoverResult.error) {
    return NextResponse.json(
      { error: matchResult.error?.message ?? walkoverResult.error?.message ?? "Unable to load club snooker matches." },
      { status: 400 }
    );
  }

  const players = (playerResult.data ?? []) as PlayerRow[];
  const walkoverMatchIds = new Set((walkoverResult.data ?? []).map((frame) => frame.match_id as string));
  const matches = ((matchResult.data ?? []) as MatchRow[]).filter(
    (match) => !walkoverMatchIds.has(match.id) && (match.winner_player_id === match.player1_id || match.winner_player_id === match.player2_id)
  );
  const state = new Map(
    players.map((player) => {
      const seed = seedRating(player);
      return [player.id, { rating: seed, peak: seed, matches: 0 }];
    })
  );

  const matchUpdates: Array<{ id: string; values: Record<string, number | string> }> = [];
  for (const match of matches) {
    const player1 = state.get(match.player1_id);
    const player2 = state.get(match.player2_id);
    if (!player1 || !player2) continue;
    const expected1 = expectedScore(player1.rating, player2.rating);
    const team1Won = match.winner_player_id === match.player1_id;
    const delta1 = Math.round(
      Math.max(kFactor(player1.rating, player1.matches), kFactor(player2.rating, player2.matches)) *
        ((team1Won ? 1 : 0) - expected1)
    );
    const delta2 = -delta1;
    const next1 = Math.max(100, player1.rating + delta1);
    const next2 = Math.max(100, player2.rating + delta2);
    state.set(match.player1_id, { rating: next1, peak: Math.max(player1.peak, next1), matches: player1.matches + 1 });
    state.set(match.player2_id, { rating: next2, peak: Math.max(player2.peak, next2), matches: player2.matches + 1 });
    matchUpdates.push({
      id: match.id,
      values: {
        rating_applied_at: match.updated_at ?? new Date().toISOString(),
        rating_delta_team1: delta1,
        rating_delta_team2: delta2,
        elo_team1_before: player1.rating,
        elo_team2_before: player2.rating,
        elo_team1_after: next1,
        elo_team2_after: next2,
        expected_team1_probability: expected1,
      },
    });
  }

  for (const player of players) {
    const next = state.get(player.id);
    if (!next) continue;
    const update = await admin
      .from("players")
      .update({ rating_snooker: next.rating, peak_rating_snooker: next.peak, rated_matches_snooker: next.matches })
      .eq("id", player.id);
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 400 });
  }
  for (const match of matchUpdates) {
    const update = await admin.from("matches").update(match.values).eq("id", match.id);
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 400 });
  }

  const rankedPlayers = [...state.values()].filter((player) => player.matches > 0).length;
  await admin.from("audit_logs").insert({
    actor_user_id: user.id,
    actor_email: user.email ?? null,
    actor_role: "super_user",
    action: "club_snooker_elo_rebuilt",
    entity_type: "rating",
    summary: `Rebuilt independent club snooker Elo from ${matchUpdates.length} eligible match(es).`,
    meta: { eligibleMatches: matchUpdates.length, rankedPlayers, source: "club_only" },
  });

  return NextResponse.json({ ok: true, matches: matchUpdates.length, rankedPlayers });
}
