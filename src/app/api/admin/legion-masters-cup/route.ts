import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
const LEAGUE_NAME = "greenhithe legion masters 2026";
const CUP_NAME = "Greenhithe Legion Masters Cup 2026";

type MatchRow = {
  id: string;
  status: string;
  player1_id: string | null;
  player2_id: string | null;
  winner_player_id: string | null;
};
type FrameRow = { match_id: string; winner_player_id: string | null };

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const appUserResult = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const role = String(appUserResult.data?.role ?? "").toLowerCase();
  const isSuper = Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail);
  if (!isSuper && !["admin", "owner"].includes(role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const competitionId = String(body?.competitionId ?? "");
  if (!competitionId) return NextResponse.json({ error: "Competition is required." }, { status: 400 });

  const sourceResult = await client
    .from("competitions")
    .select("id,name,venue,location_id,sport_type,best_of,app_assign_opening_break,handicap_enabled")
    .eq("id", competitionId)
    .maybeSingle();
  const source = sourceResult.data;
  if (!source || source.name.trim().toLowerCase() !== LEAGUE_NAME) {
    return NextResponse.json({ error: "This action is only available for Greenhithe Legion Masters 2026." }, { status: 400 });
  }

  const existingResult = await client
    .from("competitions")
    .select("id")
    .eq("location_id", source.location_id)
    .ilike("name", CUP_NAME)
    .eq("is_archived", false)
    .maybeSingle();
  if (existingResult.data?.id) return NextResponse.json({ ok: true, competitionId: existingResult.data.id, existing: true });

  const [matchesResult, entriesResult] = await Promise.all([
    client
      .from("matches")
      .select("id,status,player1_id,player2_id,winner_player_id")
      .eq("competition_id", competitionId)
      .eq("is_archived", false),
    client
      .from("competition_entries")
      .select("player_id")
      .eq("competition_id", competitionId)
      .eq("status", "approved"),
  ]);
  if (matchesResult.error || entriesResult.error) {
    return NextResponse.json({ error: matchesResult.error?.message ?? entriesResult.error?.message }, { status: 400 });
  }
  const leagueMatches = (matchesResult.data ?? []) as MatchRow[];
  const playedFixtures = leagueMatches.filter((match) => match.status !== "bye");
  if (!playedFixtures.length || playedFixtures.some((match) => match.status !== "complete")) {
    return NextResponse.json({ error: "Every league fixture must be completed or voided before creating the Masters Cup." }, { status: 409 });
  }

  const frameResult = await client.from("frames").select("match_id,winner_player_id").in("match_id", playedFixtures.map((match) => match.id));
  if (frameResult.error) return NextResponse.json({ error: frameResult.error.message }, { status: 400 });
  const frames = (frameResult.data ?? []) as FrameRow[];
  const framesByMatch = new Map<string, FrameRow[]>();
  for (const frame of frames) framesByMatch.set(frame.match_id, [...(framesByMatch.get(frame.match_id) ?? []), frame]);

  const approvedPlayerIds = [...new Set((entriesResult.data ?? []).map((entry) => String(entry.player_id)))];
  const playerResult = await client.from("players").select("id,display_name,full_name").in("id", approvedPlayerIds);
  if (playerResult.error) return NextResponse.json({ error: playerResult.error.message }, { status: 400 });
  const playerNames = new Map((playerResult.data ?? []).map((player) => [player.id, player.full_name?.trim() || player.display_name]));
  const stats = new Map(approvedPlayerIds.map((playerId) => [playerId, { playerId, points: 0, won: 0, lost: 0, name: playerNames.get(playerId) ?? "Unknown player" }]));
  for (const match of playedFixtures) {
    if (!match.player1_id || !match.player2_id) continue;
    const left = stats.get(match.player1_id);
    const right = stats.get(match.player2_id);
    if (!left || !right) continue;
    for (const frame of framesByMatch.get(match.id) ?? []) {
      if (frame.winner_player_id === match.player1_id) left.points += 1;
      if (frame.winner_player_id === match.player2_id) right.points += 1;
    }
    if (match.winner_player_id === match.player1_id) {
      left.won += 1;
      right.lost += 1;
    } else if (match.winner_player_id === match.player2_id) {
      right.won += 1;
      left.lost += 1;
    }
  }
  const qualifiers = [...stats.values()]
    .sort((a, b) => b.points - a.points || b.won - a.won || a.lost - b.lost || a.name.localeCompare(b.name))
    .slice(0, 8);
  if (qualifiers.length < 8) return NextResponse.json({ error: "At least eight approved league players are required." }, { status: 409 });

  const bestOf = Number(source.best_of ?? 5);
  const cupResult = await client.from("competitions").insert({
    name: CUP_NAME,
    venue: source.venue,
    location_id: source.location_id,
    sport_type: source.sport_type,
    competition_format: "knockout",
    best_of: bestOf,
    match_mode: "singles",
    is_practice: false,
    include_in_stats: true,
    app_assign_opening_break: source.app_assign_opening_break,
    handicap_enabled: source.handicap_enabled,
    knockout_round_best_of: { round1: bestOf, semi_final: bestOf, final: bestOf },
    signup_open: false,
    entry_fee_pence: null,
    is_archived: false,
    is_completed: false,
  }).select("id").single();
  if (cupResult.error || !cupResult.data) return NextResponse.json({ error: cupResult.error?.message ?? "Masters Cup could not be created." }, { status: 400 });
  const cupId = cupResult.data.id as string;

  const seedPairs = [[0, 7], [3, 4], [1, 6], [2, 5]];
  const cupMatches = seedPairs.map(([leftIndex, rightIndex], index) => ({
    competition_id: cupId,
    round_no: 1,
    match_no: index + 1,
    best_of: bestOf,
    status: "pending",
    match_mode: "singles",
    player1_id: qualifiers[leftIndex].playerId,
    player2_id: qualifiers[rightIndex].playerId,
    winner_player_id: null,
    opening_break_player_id: source.app_assign_opening_break ? qualifiers[index % 2 === 0 ? leftIndex : rightIndex].playerId : null,
    is_archived: false,
  }));
  const cupEntries = qualifiers.map((qualifier) => ({
    competition_id: cupId,
    requester_user_id: user.id,
    player_id: qualifier.playerId,
    status: "approved",
    payment_status: "not_required",
    reviewed_at: new Date().toISOString(),
  }));
  const [matchInsert, entryInsert] = await Promise.all([
    client.from("matches").insert(cupMatches),
    client.from("competition_entries").insert(cupEntries),
  ]);
  if (matchInsert.error || entryInsert.error) {
    await client.from("competitions").delete().eq("id", cupId);
    return NextResponse.json({ error: matchInsert.error?.message ?? entryInsert.error?.message ?? "Masters Cup setup failed." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, competitionId: cupId, qualifiers, existing: false });
}
