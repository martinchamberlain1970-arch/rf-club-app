import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLeagueFixtureDeadline } from "@/lib/league-deadline";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "");
  const vercelCronHeader = req.headers.get("x-vercel-cron");
  const isAuthorized = cronSecret ? authHeader === cronSecret : Boolean(vercelCronHeader);
  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const leagueCompetitionRes = await adminClient
    .from("competitions")
    .select("id,name")
    .eq("competition_format", "league")
    .neq("league_schedule_mode", "one_day")
    .eq("is_archived", false)
    .eq("is_completed", false);

  if (leagueCompetitionRes.error) {
    return NextResponse.json({ error: leagueCompetitionRes.error.message }, { status: 400 });
  }

  const competitionIds = (leagueCompetitionRes.data ?? []).map((competition) => competition.id as string);
  const competitionNames = new Map((leagueCompetitionRes.data ?? []).map((competition) => [competition.id as string, competition.name as string]));
  if (!competitionIds.length) {
    return NextResponse.json({ ok: true, voidedMatchIds: [] });
  }

  const matchesRes = await adminClient
    .from("matches")
    .select("id,competition_id,scheduled_for,status,winner_player_id")
    .in("competition_id", competitionIds)
    .eq("is_archived", false)
    .in("status", ["pending", "in_progress"]);

  if (matchesRes.error) {
    return NextResponse.json({ error: matchesRes.error.message }, { status: 400 });
  }

  const matches = (matchesRes.data ?? []) as Array<{
    id: string;
    competition_id: string;
    scheduled_for: string | null;
    status: "pending" | "in_progress";
    winner_player_id: string | null;
  }>;
  if (!matches.length) {
    return NextResponse.json({ ok: true, voidedMatchIds: [] });
  }

  const submissionRes = await adminClient
    .from("result_submissions")
    .select("id,match_id,status")
    .in("match_id", matches.map((match) => match.id));
  if (submissionRes.error) {
    return NextResponse.json({ error: submissionRes.error.message }, { status: 400 });
  }

  const submissionsByMatch = new Map<string, Array<{ id: string; status: "pending" | "approved" | "rejected" }>>();
  for (const submission of (submissionRes.data ?? []) as Array<{ id: string; match_id: string; status: "pending" | "approved" | "rejected" }>) {
    const prev = submissionsByMatch.get(submission.match_id) ?? [];
    prev.push(submission);
    submissionsByMatch.set(submission.match_id, prev);
  }

  const now = new Date();
  const overdueMatches = matches.filter((match) => {
    const deadline = getLeagueFixtureDeadline(match.scheduled_for, competitionNames.get(match.competition_id));
    if (!deadline || now <= deadline) return false;
    const submissions = submissionsByMatch.get(match.id) ?? [];
    return !submissions.some((submission) => submission.status === "approved");
  });

  if (!overdueMatches.length) {
    return NextResponse.json({ ok: true, voidedMatchIds: [] });
  }

  return NextResponse.json({ ok: true, voidedMatchIds: [], reviewMatchIds: overdueMatches.map((match) => match.id) });
}
