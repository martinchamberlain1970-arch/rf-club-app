import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildLeagueFixtureAnchorMap,
  buildLeagueFixtureDeadlineExceptionMap,
  getLeagueFixtureEffectiveFinalDeadline,
} from "@/lib/league-deadline";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const appUserResult = await client
    .from("app_users")
    .select("linked_player_id")
    .eq("id", user.id)
    .maybeSingle();
  if (appUserResult.error) return NextResponse.json({ error: appUserResult.error.message }, { status: 400 });
  const playerId = appUserResult.data?.linked_player_id as string | null | undefined;
  if (!playerId) return NextResponse.json({ fixtures: [] });

  const competitionsResult = await client
    .from("competitions")
    .select("id,name")
    .eq("competition_format", "league")
    .neq("league_schedule_mode", "one_day")
    .eq("is_archived", false)
    .eq("is_completed", false);
  if (competitionsResult.error) return NextResponse.json({ error: competitionsResult.error.message }, { status: 400 });
  const competitions = new Map((competitionsResult.data ?? []).map((row) => [String(row.id), String(row.name)]));
  if (!competitions.size) return NextResponse.json({ fixtures: [] });

  const matchesResult = await client
    .from("matches")
    .select("id,competition_id,player1_id,player2_id,scheduled_for")
    .in("competition_id", [...competitions.keys()])
    .eq("is_archived", false)
    .in("status", ["pending", "in_progress"])
    .or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`);
  if (matchesResult.error) return NextResponse.json({ error: matchesResult.error.message }, { status: 400 });
  const matches = (matchesResult.data ?? []).filter((match) =>
    match.player1_id && match.player2_id && match.player1_id !== match.player2_id && match.scheduled_for
  );
  if (!matches.length) return NextResponse.json({ fixtures: [] });

  const matchIds = matches.map((match) => String(match.id));
  const participantIds = [...new Set(matches.flatMap((match) => [String(match.player1_id), String(match.player2_id)]))];
  const [playersResult, submissionsResult, reschedulesResult, exceptionsResult] = await Promise.all([
    client.from("players").select("id,display_name,full_name").in("id", participantIds),
    client.from("result_submissions").select("match_id").in("match_id", matchIds).in("status", ["pending", "approved"]),
    client.from("league_reschedule_requests").select("match_id,status,original_scheduled_for,created_at").in("match_id", matchIds).in("status", ["pending", "approved"]).order("created_at", { ascending: true }),
    client.from("league_fixture_deadline_exceptions").select("match_id,extended_until,is_active").in("match_id", matchIds).eq("is_active", true),
  ]);
  const firstError = playersResult.error || submissionsResult.error || reschedulesResult.error || exceptionsResult.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 400 });

  const protectedMatches = new Set([
    ...(submissionsResult.data ?? []).map((row) => String(row.match_id)),
    ...(reschedulesResult.data ?? []).filter((row) => row.status === "pending").map((row) => String(row.match_id)),
  ]);
  const anchorByMatch = buildLeagueFixtureAnchorMap((reschedulesResult.data ?? []).filter((row) => row.status === "approved"));
  const exceptionByMatch = buildLeagueFixtureDeadlineExceptionMap(exceptionsResult.data ?? []);
  const names = new Map((playersResult.data ?? []).map((row) => [String(row.id), String(row.full_name?.trim() || row.display_name || "Player")]));
  const now = new Date();

  const fixtures = matches.flatMap((match) => {
    const matchId = String(match.id);
    if (protectedMatches.has(matchId)) return [];
    const competitionName = competitions.get(String(match.competition_id));
    if (!competitionName) return [];
    const scheduledFor = anchorByMatch.get(matchId) ?? String(match.scheduled_for);
    const finalDeadline = getLeagueFixtureEffectiveFinalDeadline(scheduledFor, competitionName, exceptionByMatch.get(matchId) ?? null);
    if (!finalDeadline || now.getTime() < finalDeadline.getTime() - 7 * DAY_MS) return [];
    const opponentId = String(match.player1_id) === playerId ? String(match.player2_id) : String(match.player1_id);
    return [{
      id: matchId,
      competitionName,
      opponentName: names.get(opponentId) ?? "your opponent",
      finalDeadline: finalDeadline.toISOString(),
      phase: now >= finalDeadline ? "deadline_passed" : "final_warning",
      createdAt: new Date(finalDeadline.getTime() - 7 * DAY_MS).toISOString(),
    }];
  });

  return NextResponse.json({ fixtures });
}
