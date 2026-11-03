import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { awardDeadlineWalkover } from "@/lib/fixture-deadline-award";
import { getLeagueFixtureWalkoverReviewUntil } from "@/lib/league-deadline";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();

async function authorizeManager(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return { error: "Server is not configured.", status: 500 } as const;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Unauthorized.", status: 401 } as const;
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return { error: "Unauthorized.", status: 401 } as const;
  const appUserResult = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const role = String(appUserResult.data?.role ?? "");
  if (!["owner", "admin"].includes(role) && !(superAdminEmail && user.email?.toLowerCase() === superAdminEmail)) return { error: "Club Manager access required.", status: 403 } as const;
  return { client, user, role: role || "owner" } as const;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeManager(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const competitionsResult = await auth.client.from("competitions").select("id,name").eq("competition_format", "league").neq("league_schedule_mode", "one_day").eq("is_archived", false).eq("is_completed", false);
  if (competitionsResult.error) return NextResponse.json({ error: competitionsResult.error.message }, { status: 400 });
  const competitions = new Map((competitionsResult.data ?? []).map((row) => [row.id as string, row.name as string]));
  if (!competitions.size) return NextResponse.json({ fixtures: [] });
  const matchesResult = await auth.client.from("matches").select("id,competition_id,scheduled_for,player1_id,player2_id").in("competition_id", [...competitions.keys()]).eq("is_archived", false).in("status", ["pending", "in_progress"]);
  if (matchesResult.error) return NextResponse.json({ error: matchesResult.error.message }, { status: 400 });
  const now = new Date();
  const due = (matchesResult.data ?? []).filter((match) => {
    const reviewUntil = getLeagueFixtureWalkoverReviewUntil(match.scheduled_for, competitions.get(match.competition_id));
    return Boolean(match.player1_id && match.player2_id && match.player1_id !== match.player2_id && reviewUntil && reviewUntil < now);
  });
  if (!due.length) return NextResponse.json({ fixtures: [] });
  const matchIds = due.map((match) => match.id);
  const [submissionsResult, eventsResult, playersResult] = await Promise.all([
    auth.client.from("result_submissions").select("match_id").in("match_id", matchIds).in("status", ["pending", "approved"]),
    auth.client.from("audit_logs").select("entity_id,action,created_at").eq("entity_type", "match").in("entity_id", matchIds).in("action", ["fixture_deadline_evidence_submitted", "fixture_deadline_walkover_awarded"]),
    auth.client.from("players").select("id,display_name,full_name").in("id", [...new Set(due.flatMap((match) => [match.player1_id, match.player2_id]).filter(Boolean) as string[])]),
  ]);
  if (submissionsResult.error || eventsResult.error || playersResult.error) return NextResponse.json({ error: submissionsResult.error?.message || eventsResult.error?.message || playersResult.error?.message }, { status: 400 });
  const protectedMatches = new Set((submissionsResult.data ?? []).map((row) => String(row.match_id)));
  const awardedMatches = new Set((eventsResult.data ?? []).filter((row) => row.action === "fixture_deadline_walkover_awarded").map((row) => String(row.entity_id)));
  const evidenceMatches = new Set((eventsResult.data ?? []).filter((row) => row.action === "fixture_deadline_evidence_submitted").map((row) => String(row.entity_id)));
  const names = new Map((playersResult.data ?? []).map((player) => [player.id, player.full_name?.trim() || player.display_name]));
  return NextResponse.json({ fixtures: due.filter((match) => !protectedMatches.has(match.id) && !awardedMatches.has(match.id)).map((match) => ({
    id: match.id,
    competitionName: competitions.get(match.competition_id) || "League",
    playerOne: names.get(match.player1_id ?? "") || "First-named player",
    playerTwo: names.get(match.player2_id ?? "") || "Second-named player",
    reviewUntil: getLeagueFixtureWalkoverReviewUntil(match.scheduled_for, competitions.get(match.competition_id))?.toISOString() ?? null,
    evidenceSubmitted: evidenceMatches.has(match.id),
  })) });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeManager(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null);
  const matchId = String(body?.matchId ?? "").trim();
  if (!matchId) return NextResponse.json({ error: "Fixture is required." }, { status: 400 });
  const matchResult = await auth.client.from("matches").select("id,competition_id,scheduled_for,status").eq("id", matchId).maybeSingle();
  if (matchResult.error || !matchResult.data) return NextResponse.json({ error: matchResult.error?.message || "Fixture not found." }, { status: 404 });
  const competitionResult = await auth.client.from("competitions").select("name,competition_format,league_schedule_mode,is_archived,is_completed").eq("id", matchResult.data.competition_id).maybeSingle();
  if (competitionResult.error || !competitionResult.data || competitionResult.data.competition_format !== "league" || competitionResult.data.league_schedule_mode === "one_day" || competitionResult.data.is_archived || competitionResult.data.is_completed) {
    return NextResponse.json({ error: competitionResult.error?.message || "This fixture does not use the weekly deadline workflow." }, { status: 400 });
  }
  const reviewUntil = getLeagueFixtureWalkoverReviewUntil(matchResult.data.scheduled_for, competitionResult.data?.name);
  if (!reviewUntil || reviewUntil > new Date()) return NextResponse.json({ error: "The fixture's 24-hour review period has not closed yet." }, { status: 409 });
  const [evidence, submission] = await Promise.all([
    auth.client.from("audit_logs").select("id").eq("entity_type", "match").eq("entity_id", matchId).eq("action", "fixture_deadline_evidence_submitted").limit(1).maybeSingle(),
    auth.client.from("result_submissions").select("id").eq("match_id", matchId).in("status", ["pending", "approved"]).limit(1).maybeSingle(),
  ]);
  if (evidence.error || submission.error) return NextResponse.json({ error: evidence.error?.message || submission.error?.message }, { status: 400 });
  if (submission.data) return NextResponse.json({ error: "A result has already been submitted. Review it in Results & Approvals instead of awarding a walkover." }, { status: 409 });
  if (evidence.data) return NextResponse.json({ error: "Arranging evidence has been submitted. Open the fixture and review the evidence before deciding the outcome." }, { status: 409 });
  try {
    const result = await awardDeadlineWalkover(auth.client, matchId, { user: auth.user, role: auth.role });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The deadline decision could not be saved." }, { status: 400 });
  }
}
