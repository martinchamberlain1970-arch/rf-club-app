import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;

function getLeagueFixtureDeadline(scheduledFor: string | null | undefined) {
  if (!scheduledFor) return null;
  const [year, month, day] = scheduledFor.split("-").map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day + 6, 21, 0, 0, 0);
}

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
    .select("id")
    .eq("competition_format", "league")
    .eq("is_archived", false)
    .eq("is_completed", false);

  if (leagueCompetitionRes.error) {
    return NextResponse.json({ error: leagueCompetitionRes.error.message }, { status: 400 });
  }

  const competitionIds = (leagueCompetitionRes.data ?? []).map((competition) => competition.id as string);
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
    const deadline = getLeagueFixtureDeadline(match.scheduled_for);
    if (!deadline || now <= deadline) return false;
    const submissions = submissionsByMatch.get(match.id) ?? [];
    return !submissions.some((submission) => submission.status === "pending" || submission.status === "approved");
  });

  if (!overdueMatches.length) {
    return NextResponse.json({ ok: true, voidedMatchIds: [] });
  }

  const overdueMatchIds = overdueMatches.map((match) => match.id);

  const frameDeleteRes = await adminClient.from("frames").delete().in("match_id", overdueMatchIds);
  if (frameDeleteRes.error) {
    return NextResponse.json({ error: frameDeleteRes.error.message }, { status: 400 });
  }

  const matchUpdateRes = await adminClient
    .from("matches")
    .update({ status: "complete", winner_player_id: null })
    .in("id", overdueMatchIds);
  if (matchUpdateRes.error) {
    return NextResponse.json({ error: matchUpdateRes.error.message }, { status: 400 });
  }

  const submissionUpdateRes = await adminClient
    .from("result_submissions")
    .update({
      status: "rejected",
      reviewed_at: new Date().toISOString(),
      note: "Fixture auto-voided after deadline without a submitted result.",
    })
    .in("match_id", overdueMatchIds)
    .neq("status", "rejected");
  if (submissionUpdateRes.error) {
    return NextResponse.json({ error: submissionUpdateRes.error.message }, { status: 400 });
  }

  await adminClient.from("audit_logs").insert({
    actor_user_id: null,
    actor_email: null,
    actor_role: "system",
    action: "league_fixture_auto_voided_cron",
    entity_type: "system",
    entity_id: "league-fixtures",
    summary: `Cron auto-voided ${overdueMatchIds.length} overdue league fixture${overdueMatchIds.length === 1 ? "" : "s"}.`,
    meta: { voidedMatchIds: overdueMatchIds },
  });

  return NextResponse.json({ ok: true, voidedMatchIds: overdueMatchIds });
}
