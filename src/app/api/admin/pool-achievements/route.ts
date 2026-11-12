import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (
  process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? ""
).trim().toLowerCase();

type AchievementType = "break_and_run" | "run_out_against_break";

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authResult = await authClient.auth.getUser(token);
  const user = authResult.data.user;
  if (authResult.error || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const requesterEmail = user.email?.trim().toLowerCase() ?? "";
  if (!superAdminEmail || requesterEmail !== superAdminEmail) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    matchId?: string;
    frameNumber?: number;
    achievementType?: AchievementType;
  } | null;
  const matchId = body?.matchId?.trim();
  const frameNumber = Number(body?.frameNumber);
  const achievementType = body?.achievementType;
  if (!matchId || !Number.isInteger(frameNumber) || frameNumber < 1 || !achievementType) {
    return NextResponse.json({ error: "Match, rack and achievement type are required." }, { status: 400 });
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const matchResult = await client
    .from("matches")
    .select("id,competition_id,status,player1_id,player2_id")
    .eq("id", matchId)
    .maybeSingle();
  if (matchResult.error || !matchResult.data) {
    return NextResponse.json({ error: matchResult.error?.message ?? "Match not found." }, { status: 404 });
  }
  const match = matchResult.data;
  if (match.status !== "complete" || !match.player1_id || !match.player2_id) {
    return NextResponse.json({ error: "Only a completed singles match can be corrected here." }, { status: 400 });
  }

  const competitionResult = await client
    .from("competitions")
    .select("sport_type")
    .eq("id", match.competition_id)
    .maybeSingle();
  if (competitionResult.error || !competitionResult.data || !String(competitionResult.data.sport_type).startsWith("pool")) {
    return NextResponse.json({ error: "This correction is only available for pool matches." }, { status: 400 });
  }

  const frameResult = await client
    .from("frames")
    .select("frame_number,winner_player_id,is_walkover_award")
    .eq("match_id", matchId)
    .eq("frame_number", frameNumber)
    .maybeSingle();
  const frame = frameResult.data;
  if (frameResult.error || !frame || !frame.winner_player_id || frame.is_walkover_award) {
    return NextResponse.json({ error: frameResult.error?.message ?? "Choose a played rack with a recorded winner." }, { status: 400 });
  }

  const updateResult = await client
    .from("frames")
    .update({
      break_and_run: achievementType === "break_and_run",
      run_out_against_break: achievementType === "run_out_against_break",
    })
    .eq("match_id", matchId)
    .eq("frame_number", frameNumber);
  if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 400 });

  const framesResult = await client
    .from("frames")
    .select("winner_player_id,break_and_run,run_out_against_break,is_walkover_award")
    .eq("match_id", matchId);
  if (framesResult.error) return NextResponse.json({ error: framesResult.error.message }, { status: 400 });

  const playedFrames = (framesResult.data ?? []).filter((row) => !row.is_walkover_award);
  const counts = {
    break_and_run_team1: playedFrames.filter((row) => row.winner_player_id === match.player1_id && row.break_and_run).length,
    break_and_run_team2: playedFrames.filter((row) => row.winner_player_id === match.player2_id && row.break_and_run).length,
    run_out_against_break_team1: playedFrames.filter((row) => row.winner_player_id === match.player1_id && row.run_out_against_break).length,
    run_out_against_break_team2: playedFrames.filter((row) => row.winner_player_id === match.player2_id && row.run_out_against_break).length,
  };
  const submissionsResult = await client
    .from("result_submissions")
    .update({
      ...counts,
      break_and_run: counts.break_and_run_team1 + counts.break_and_run_team2 > 0,
      run_out_against_break: counts.run_out_against_break_team1 + counts.run_out_against_break_team2 > 0,
    })
    .eq("match_id", matchId)
    .eq("status", "approved");
  if (submissionsResult.error) {
    return NextResponse.json({ error: submissionsResult.error.message }, { status: 400 });
  }

  await client.from("audit_logs").insert({
    actor_user_id: user.id,
    actor_email: requesterEmail,
    actor_role: "owner",
    action: "pool_achievement_corrected",
    entity_type: "match",
    entity_id: matchId,
    summary: `Recorded ${achievementType === "break_and_run" ? "Break & Run" : "Run Out Against the Break"} on rack ${frameNumber}.`,
    meta: { frameNumber, achievementType, winnerPlayerId: frame.winner_player_id },
  });

  return NextResponse.json({ ok: true, counts });
}
