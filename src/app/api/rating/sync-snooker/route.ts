import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail =
  process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  "";
const sharedRatingApiKey = process.env.SHARED_RATING_API_KEY?.trim() ?? "";
const leagueSharedRatingUrl =
  process.env.LEAGUE_SHARED_RATING_URL?.trim() ?? "https://rf-league-app.vercel.app/api/rating/apply-snooker-result";

type ClubPlayerRow = {
  id: string;
  rating_snooker: number | null;
  peak_rating_snooker: number | null;
  rated_matches_snooker: number | null;
};

function isAdminRole(role?: string | null) {
  const normalized = role?.trim().toLowerCase() ?? "";
  return normalized === "admin" || normalized === "owner";
}

export async function POST(req: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }
  if (!sharedRatingApiKey) {
    return NextResponse.json({ error: "Shared rating API key is not configured." }, { status: 500 });
  }

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const authRes = await authClient.auth.getUser(token);
  const user = authRes.data.user;
  if (authRes.error || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const requesterEmail = user.email?.trim().toLowerCase() ?? "";
  const appUserRes = await adminClient.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const appRole = (appUserRes.data?.role as string | null) ?? null;
  const isSuper = Boolean(superAdminEmail && requesterEmail === superAdminEmail);
  if (!isSuper && !isAdminRole(appRole)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const matchId = typeof body?.matchId === "string" ? body.matchId.trim() : "";
  const winnerSide = body?.winnerSide === 1 || body?.winnerSide === 2 ? body.winnerSide : null;
  if (!matchId || !winnerSide) {
    return NextResponse.json({ error: "matchId and winnerSide are required." }, { status: 400 });
  }

  const matchRes = await adminClient
    .from("matches")
    .select("id,competition_id,status,match_mode,player1_id,player2_id,rating_applied_at")
    .eq("id", matchId)
    .maybeSingle();
  if (matchRes.error) return NextResponse.json({ error: matchRes.error.message }, { status: 400 });
  if (!matchRes.data) return NextResponse.json({ error: "Match not found." }, { status: 404 });

  const match = matchRes.data as {
    id: string;
    competition_id: string;
    status: string;
    match_mode: "singles" | "doubles";
    player1_id: string | null;
    player2_id: string | null;
    rating_applied_at: string | null;
  };
  if (match.rating_applied_at) {
    return NextResponse.json({ ok: true, skipped: true, reason: "already_applied" });
  }
  if (match.status === "bye" || match.match_mode !== "singles") {
    return NextResponse.json({ ok: true, skipped: true, reason: "not_rated_match_type" });
  }

  const competitionRes = await adminClient
    .from("competitions")
    .select("id,name,sport_type,is_practice")
    .eq("id", match.competition_id)
    .maybeSingle();
  if (competitionRes.error) return NextResponse.json({ error: competitionRes.error.message }, { status: 400 });
  if (!competitionRes.data) return NextResponse.json({ error: "Competition not found." }, { status: 404 });
  if (competitionRes.data.sport_type !== "snooker") {
    return NextResponse.json({ ok: true, skipped: true, reason: "not_snooker" });
  }
  if (competitionRes.data.is_practice) {
    return NextResponse.json({ ok: true, skipped: true, reason: "practice_match" });
  }

  const walkoverCheck = await adminClient
    .from("frames")
    .select("frame_number", { count: "exact", head: true })
    .eq("match_id", match.id)
    .eq("is_walkover_award", true);
  if (walkoverCheck.error) return NextResponse.json({ error: walkoverCheck.error.message }, { status: 400 });
  if ((walkoverCheck.count ?? 0) > 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "walkover" });
  }

  const winnerPlayerId = winnerSide === 1 ? match.player1_id : match.player2_id;
  const loserPlayerId = winnerSide === 1 ? match.player2_id : match.player1_id;
  if (!winnerPlayerId || !loserPlayerId) {
    return NextResponse.json({ error: "Unable to resolve players for shared snooker rating sync." }, { status: 400 });
  }

  const leagueResponse = await fetch(leagueSharedRatingUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shared-rating-key": sharedRatingApiKey,
    },
    body: JSON.stringify({
      source_app: "club",
      source_result_id: `club-match:${match.id}`,
      winner_source_player_id: winnerPlayerId,
      loser_source_player_id: loserPlayerId,
      winner_score: 1,
      loser_score: 0,
      notes: `Club match ${match.id} (${competitionRes.data.name})`,
      metadata: {
        competition_id: match.competition_id,
        match_id: match.id,
      },
    }),
  });

  const leaguePayload = (await leagueResponse.json().catch(() => ({}))) as {
    error?: string;
    ok?: boolean;
    skipped?: boolean;
    delta_winner?: number;
    delta_loser?: number;
  };
  if (!leagueResponse.ok || !leaguePayload.ok) {
    return NextResponse.json({ error: leaguePayload.error ?? "Shared league rating sync failed." }, { status: 400 });
  }

  const playerRes = await adminClient
    .from("players")
    .select("id,rating_snooker,peak_rating_snooker,rated_matches_snooker")
    .in("id", [winnerPlayerId, loserPlayerId]);
  if (playerRes.error) return NextResponse.json({ error: playerRes.error.message }, { status: 400 });
  const players = (playerRes.data ?? []) as ClubPlayerRow[];
  const playerById = new Map(players.map((p) => [p.id, p]));

  const winnerLocal = playerById.get(winnerPlayerId);
  const loserLocal = playerById.get(loserPlayerId);
  if (winnerLocal) {
    const current = winnerLocal.rating_snooker ?? 1000;
    const next = Math.max(100, current + Number(leaguePayload.delta_winner ?? 0));
    const peak = Math.max(winnerLocal.peak_rating_snooker ?? 1000, next);
    const played = (winnerLocal.rated_matches_snooker ?? 0) + 1;
    const upd = await adminClient
      .from("players")
      .update({ rating_snooker: next, peak_rating_snooker: peak, rated_matches_snooker: played })
      .eq("id", winnerPlayerId);
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 });
  }
  if (loserLocal) {
    const current = loserLocal.rating_snooker ?? 1000;
    const next = Math.max(100, current + Number(leaguePayload.delta_loser ?? 0));
    const peak = Math.max(loserLocal.peak_rating_snooker ?? 1000, next);
    const played = (loserLocal.rated_matches_snooker ?? 0) + 1;
    const upd = await adminClient
      .from("players")
      .update({ rating_snooker: next, peak_rating_snooker: peak, rated_matches_snooker: played })
      .eq("id", loserPlayerId);
    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 400 });
  }

  const markAppliedRes = await adminClient
    .from("matches")
    .update({
      rating_applied_at: new Date().toISOString(),
      rating_delta_team1: winnerSide === 1 ? Number(leaguePayload.delta_winner ?? 0) : Number(leaguePayload.delta_loser ?? 0),
      rating_delta_team2: winnerSide === 2 ? Number(leaguePayload.delta_winner ?? 0) : Number(leaguePayload.delta_loser ?? 0),
    })
    .eq("id", match.id);
  if (markAppliedRes.error) return NextResponse.json({ error: markAppliedRes.error.message }, { status: 400 });

  return NextResponse.json({
    ok: true,
    skipped: false,
    deltaTeam1: winnerSide === 1 ? Number(leaguePayload.delta_winner ?? 0) : Number(leaguePayload.delta_loser ?? 0),
    deltaTeam2: winnerSide === 2 ? Number(leaguePayload.delta_winner ?? 0) : Number(leaguePayload.delta_loser ?? 0),
  });
}
