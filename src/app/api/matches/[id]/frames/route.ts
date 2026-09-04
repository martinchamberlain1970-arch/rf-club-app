import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();

type RouteContext = { params: Promise<{ id: string }> };

type FramePayload = {
  match_id: string;
  frame_number: number;
  winner_player_id: string | null;
  break_and_run: boolean;
  run_out_against_break: boolean;
  is_walkover_award: boolean;
  team1_points: number;
  team2_points: number;
  breaks_over_30_team1_values: number[];
  breaks_over_30_team2_values: number[];
  breaks_over_30_team1: number;
  breaks_over_30_team2: number;
  high_break_team1: number;
  high_break_team2: number;
};

const isNonNegativeInteger = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;
const isBreakList = (value: unknown): value is number[] => Array.isArray(value) && value.every(isNonNegativeInteger);

export async function POST(request: NextRequest, context: RouteContext) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Sign in again before saving this result." }, { status: 401 });

  const authClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const authResult = await authClient.auth.getUser(token);
  const user = authResult.data.user;
  if (authResult.error || !user) return NextResponse.json({ error: "Sign in again before saving this result." }, { status: 401 });

  const { id: matchId } = await context.params;
  const body = await request.json().catch(() => null);
  const rows = Array.isArray(body?.rows) ? body.rows as FramePayload[] : null;
  const cleanupSurplus = body?.cleanupSurplus === true;
  if (!rows) return NextResponse.json({ error: "Frame data is required." }, { status: 400 });

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const [viewerResult, matchResult] = await Promise.all([
    client.from("app_users").select("role,linked_player_id").eq("id", user.id).maybeSingle(),
    client
      .from("matches")
      .select("id,competition_id,best_of,is_archived,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id")
      .eq("id", matchId)
      .maybeSingle(),
  ]);
  const viewer = viewerResult.data;
  const match = matchResult.data;
  if (viewerResult.error || matchResult.error || !viewer || !match) {
    return NextResponse.json({ error: "Fixture access could not be verified." }, { status: 403 });
  }
  if (match.is_archived) return NextResponse.json({ error: "This match is archived. Restore it to edit." }, { status: 400 });

  const participantIds = [
    match.player1_id,
    match.player2_id,
    match.team1_player1_id,
    match.team1_player2_id,
    match.team2_player1_id,
    match.team2_player2_id,
  ].filter(Boolean) as string[];
  const role = String(viewer.role ?? "").toLowerCase();
  const isSuper = ["owner", "super"].includes(role) || Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail);
  const isParticipant = Boolean(viewer.linked_player_id && participantIds.includes(viewer.linked_player_id));
  let isClubAdmin = false;
  if (!isSuper && role === "admin" && viewer.linked_player_id) {
    const [competitionResult, managerResult] = await Promise.all([
      client.from("competitions").select("location_id").eq("id", match.competition_id).maybeSingle(),
      client.from("players").select("location_id").eq("id", viewer.linked_player_id).maybeSingle(),
    ]);
    isClubAdmin = Boolean(
      competitionResult.data?.location_id && competitionResult.data.location_id === managerResult.data?.location_id
    );
  }
  if (!isSuper && !isClubAdmin && !isParticipant) {
    return NextResponse.json({ error: "You can only save a result for your own fixture." }, { status: 403 });
  }

  const participantSet = new Set(participantIds);
  const frameNumbers = new Set<number>();
  for (const row of rows) {
    const valid = row?.match_id === matchId
      && Number.isInteger(row.frame_number)
      && row.frame_number >= 1
      && row.frame_number <= match.best_of
      && !frameNumbers.has(row.frame_number)
      && (row.winner_player_id === null || participantSet.has(row.winner_player_id))
      && typeof row.break_and_run === "boolean"
      && typeof row.run_out_against_break === "boolean"
      && typeof row.is_walkover_award === "boolean"
      && isNonNegativeInteger(row.team1_points)
      && isNonNegativeInteger(row.team2_points)
      && isBreakList(row.breaks_over_30_team1_values)
      && isBreakList(row.breaks_over_30_team2_values)
      && isNonNegativeInteger(row.breaks_over_30_team1)
      && isNonNegativeInteger(row.breaks_over_30_team2)
      && isNonNegativeInteger(row.high_break_team1)
      && isNonNegativeInteger(row.high_break_team2);
    if (!valid) return NextResponse.json({ error: "The submitted frame data is invalid." }, { status: 400 });
    frameNumbers.add(row.frame_number);
  }

  if (!rows.length) {
    const wipe = await client.from("frames").delete().eq("match_id", matchId);
    if (wipe.error) return NextResponse.json({ error: wipe.error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const write = await client.from("frames").upsert(rows, { onConflict: "match_id,frame_number" });
  if (write.error) return NextResponse.json({ error: write.error.message }, { status: 400 });

  if (cleanupSurplus) {
    const highestFrameNumber = Math.max(...rows.map((row) => row.frame_number));
    const cleanup = await client.from("frames").delete().eq("match_id", matchId).gt("frame_number", highestFrameNumber);
    if (cleanup.error) return NextResponse.json({ error: cleanup.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
