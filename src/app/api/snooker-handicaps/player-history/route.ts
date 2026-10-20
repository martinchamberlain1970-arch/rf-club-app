import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MatchRow = {
  id: string;
  player1_id: string;
  player2_id: string;
  winner_player_id: string | null;
  rating_applied_at: string | null;
  updated_at: string | null;
  rating_delta_team1: number | null;
  rating_delta_team2: number | null;
  elo_team1_before: number | null;
  elo_team2_before: number | null;
  elo_team1_after: number | null;
  elo_team2_after: number | null;
};

type FrameRow = {
  match_id: string;
  frame_number: number;
  team1_points: number | null;
  team2_points: number | null;
};

function rounded(value: number | null | undefined) {
  return value == null || !Number.isFinite(Number(value)) ? null : Math.round(Number(value));
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const authClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const authResult = await authClient.auth.getUser(token);
  if (authResult.error || !authResult.data.user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const competitionId = request.nextUrl.searchParams.get("competitionId")?.trim() ?? "";
  const playerId = request.nextUrl.searchParams.get("playerId")?.trim() ?? "";
  if (!UUID_PATTERN.test(competitionId) || !UUID_PATTERN.test(playerId)) {
    return NextResponse.json({ error: "A valid competition and player are required." }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const [competitionResult, entryResult, playerResult] = await Promise.all([
    admin.from("competitions").select("id,sport_type,handicap_enabled").eq("id", competitionId).maybeSingle(),
    admin.from("competition_entries").select("id").eq("competition_id", competitionId).eq("player_id", playerId).eq("status", "approved").maybeSingle(),
    admin.from("players").select("id,display_name,full_name,rating_snooker").eq("id", playerId).maybeSingle(),
  ]);
  const loadError = competitionResult.error ?? entryResult.error ?? playerResult.error;
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 400 });
  if (!competitionResult.data || competitionResult.data.sport_type !== "snooker" || !competitionResult.data.handicap_enabled) {
    return NextResponse.json({ error: "This history is only available for a handicapped snooker competition." }, { status: 400 });
  }
  if (!entryResult.data || !playerResult.data) return NextResponse.json({ error: "Player not found in this competition." }, { status: 404 });

  const matchesResult = await admin
    .from("matches")
    .select("id,player1_id,player2_id,winner_player_id,rating_applied_at,updated_at,rating_delta_team1,rating_delta_team2,elo_team1_before,elo_team2_before,elo_team1_after,elo_team2_after")
    .eq("competition_id", competitionId)
    .eq("status", "complete")
    .eq("is_archived", false)
    .not("rating_applied_at", "is", null)
    .or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`)
    .order("rating_applied_at", { ascending: false });
  if (matchesResult.error) return NextResponse.json({ error: matchesResult.error.message }, { status: 400 });
  const matches = (matchesResult.data ?? []) as MatchRow[];
  const opponentIds = [...new Set(matches.map((match) => match.player1_id === playerId ? match.player2_id : match.player1_id))];
  const matchIds = matches.map((match) => match.id);
  const [opponentsResult, framesResult] = await Promise.all([
    opponentIds.length
      ? admin.from("players").select("id,display_name,full_name").in("id", opponentIds)
      : Promise.resolve({ data: [], error: null }),
    matchIds.length
      ? admin.from("frames").select("match_id,frame_number,team1_points,team2_points").in("match_id", matchIds).order("frame_number", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (opponentsResult.error || framesResult.error) {
    return NextResponse.json({ error: opponentsResult.error?.message ?? framesResult.error?.message ?? "Unable to load result history." }, { status: 400 });
  }

  const opponentNames = new Map((opponentsResult.data ?? []).map((player) => [
    player.id as string,
    (player.full_name as string | null)?.trim() || (player.display_name as string),
  ]));
  const framesByMatch = new Map<string, FrameRow[]>();
  ((framesResult.data ?? []) as FrameRow[]).forEach((frame) => {
    framesByMatch.set(frame.match_id, [...(framesByMatch.get(frame.match_id) ?? []), frame]);
  });

  const results = matches.map((match) => {
    const isTeamOne = match.player1_id === playerId;
    const opponentId = isTeamOne ? match.player2_id : match.player1_id;
    const delta = rounded(isTeamOne ? match.rating_delta_team1 : match.rating_delta_team2) ?? 0;
    const recordedBefore = rounded(isTeamOne ? match.elo_team1_before : match.elo_team2_before);
    const recordedAfter = rounded(isTeamOne ? match.elo_team1_after : match.elo_team2_after);
    const before = recordedBefore ?? (recordedAfter != null ? recordedAfter - delta : 1000);
    const after = recordedAfter ?? before + delta;
    return {
      id: match.id,
      ratedAt: match.rating_applied_at ?? match.updated_at,
      opponentName: opponentNames.get(opponentId) ?? "Opponent",
      won: match.winner_player_id === playerId,
      before,
      after,
      delta,
      frames: (framesByMatch.get(match.id) ?? []).map((frame) => ({
        frameNumber: frame.frame_number,
        playerPoints: Number(isTeamOne ? frame.team1_points ?? 0 : frame.team2_points ?? 0),
        opponentPoints: Number(isTeamOne ? frame.team2_points ?? 0 : frame.team1_points ?? 0),
      })),
    };
  });

  return NextResponse.json({
    player: {
      id: playerResult.data.id,
      name: playerResult.data.full_name?.trim() || playerResult.data.display_name,
      currentElo: Math.round(Number(playerResult.data.rating_snooker ?? 1000)),
    },
    results,
  });
}
