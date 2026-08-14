import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLeagueFixtureDeadline } from "@/lib/league-deadline";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const appUserResult = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const isSuper = appUserResult.data?.role === "owner" || Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail);
  if (!isSuper) return NextResponse.json({ error: "Super User access required." }, { status: 403 });

  const competitionsResult = await client
    .from("competitions")
    .select("id,name")
    .eq("competition_format", "league")
    .neq("league_schedule_mode", "one_day")
    .eq("is_archived", false)
    .eq("is_completed", false);
  if (competitionsResult.error) return NextResponse.json({ error: competitionsResult.error.message }, { status: 400 });
  const competitionIds = (competitionsResult.data ?? []).map((competition) => competition.id);
  if (!competitionIds.length) return NextResponse.json({ fixtures: [] });

  const matchesResult = await client
    .from("matches")
    .select("id,competition_id,round_no,match_no,scheduled_for,status,player1_id,player2_id,best_of")
    .in("competition_id", competitionIds)
    .eq("is_archived", false)
    .in("status", ["pending", "in_progress"])
    .order("scheduled_for");
  if (matchesResult.error) return NextResponse.json({ error: matchesResult.error.message }, { status: 400 });
  const now = new Date();
  const overdueMatches = (matchesResult.data ?? []).filter((match) => {
    const deadline = getLeagueFixtureDeadline(match.scheduled_for);
    return Boolean(deadline && now > deadline);
  });
  if (!overdueMatches.length) return NextResponse.json({ fixtures: [] });

  const matchIds = overdueMatches.map((match) => match.id);
  const playerIds = [...new Set(overdueMatches.flatMap((match) => [match.player1_id, match.player2_id]).filter(Boolean) as string[])];
  const [submissionsResult, playersResult] = await Promise.all([
    client
      .from("result_submissions")
      .select("id,match_id,competition_entry_id,team1_score,team2_score,submitted_at,status")
      .in("match_id", matchIds)
      .eq("status", "pending")
      .order("submitted_at"),
    client.from("players").select("id,display_name,full_name").in("id", playerIds),
  ]);
  if (submissionsResult.error || playersResult.error) {
    return NextResponse.json({ error: submissionsResult.error?.message || playersResult.error?.message }, { status: 400 });
  }
  const competitionNames = new Map((competitionsResult.data ?? []).map((competition) => [competition.id, competition.name]));
  const playerNames = new Map((playersResult.data ?? []).map((player) => [player.id, player.full_name?.trim() || player.display_name]));
  const submissionsByMatch = new Map<string, typeof submissionsResult.data>();
  for (const submission of submissionsResult.data ?? []) {
    submissionsByMatch.set(submission.match_id, [...(submissionsByMatch.get(submission.match_id) ?? []), submission]);
  }

  const fixtures = overdueMatches.map((match) => {
    const submissions = submissionsByMatch.get(match.id) ?? [];
    const entrantIds = new Set(submissions.map((submission) => submission.competition_entry_id).filter(Boolean));
    const scores = new Set(submissions.map((submission) => `${submission.team1_score}-${submission.team2_score}`));
    return {
      id: match.id,
      competitionName: competitionNames.get(match.competition_id) || "League",
      week: match.round_no ?? 1,
      scheduledFor: match.scheduled_for,
      deadline: getLeagueFixtureDeadline(match.scheduled_for)?.toISOString() ?? null,
      player1: playerNames.get(match.player1_id ?? "") || "TBC",
      player2: playerNames.get(match.player2_id ?? "") || "TBC",
      bestOf: match.best_of,
      submissionCount: submissions.length,
      decision: submissions.length === 0 ? "no_submission" : entrantIds.size >= 2 && scores.size >= 2 ? "dispute" : entrantIds.size >= 2 ? "agreed" : "single_submission",
      submissions: submissions.map((submission) => ({
        id: submission.id,
        team1Score: submission.team1_score,
        team2Score: submission.team2_score,
        submittedAt: submission.submitted_at,
      })),
    };
  });
  return NextResponse.json({ fixtures });
}
