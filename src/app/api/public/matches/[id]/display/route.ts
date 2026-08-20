import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!supabaseUrl || !serviceRoleKey || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Live match not found." }, { status: 404 });
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const matchResult = await client
    .from("matches")
    .select("id,competition_id,round_no,match_no,best_of,status,match_mode,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id,winner_player_id,opening_break_player_id,team1_handicap_start,team2_handicap_start")
    .eq("id", id)
    .eq("is_archived", false)
    .maybeSingle();

  if (matchResult.error || !matchResult.data) {
    return NextResponse.json({ error: "Live match not found." }, { status: 404 });
  }

  const match = matchResult.data;
  const playerIds = [...new Set([
    match.player1_id,
    match.player2_id,
    match.team1_player1_id,
    match.team1_player2_id,
    match.team2_player1_id,
    match.team2_player2_id,
    match.winner_player_id,
    match.opening_break_player_id,
  ].filter((value): value is string => Boolean(value)))];

  const [competitionResult, playersResult, framesResult] = await Promise.all([
    client
      .from("competitions")
      .select("id,name,sport_type,competition_format,handicap_enabled")
      .eq("id", match.competition_id)
      .maybeSingle(),
    playerIds.length
      ? client.from("players").select("id,display_name,full_name,avatar_url").in("id", playerIds)
      : Promise.resolve({ data: [], error: null }),
    client
      .from("frames")
      .select("frame_number,winner_player_id,is_walkover_award")
      .eq("match_id", id)
      .order("frame_number", { ascending: true }),
  ]);

  const error = competitionResult.error || playersResult.error || framesResult.error;
  if (error || !competitionResult.data) {
    return NextResponse.json({ error: "Live match could not be loaded." }, { status: 500 });
  }

  return NextResponse.json(
    {
      match,
      competition: competitionResult.data,
      players: playersResult.data ?? [],
      frames: framesResult.data ?? [],
      updatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
