import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLeagueFixtureDeadline } from "@/lib/league-deadline";
import { sendPushToUserIds } from "@/lib/push-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();

async function authorizeSuperUser(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return { error: "Server is not configured.", status: 500 } as const;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Unauthorized.", status: 401 } as const;
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return { error: "Unauthorized.", status: 401 } as const;
  const appUserResult = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const isSuper = appUserResult.data?.role === "owner" || Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail);
  if (!isSuper) return { error: "Super User access required.", status: 403 } as const;
  return { client, user, role: String(appUserResult.data?.role ?? "owner") } as const;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeSuperUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { client } = auth;

  const competitionsResult = await client
    .from("competitions")
    .select("id,name")
    .eq("competition_format", "league")
    .neq("league_schedule_mode", "one_day")
    .eq("is_archived", false)
    .eq("is_completed", false);
  if (competitionsResult.error) return NextResponse.json({ error: competitionsResult.error.message }, { status: 400 });
  const competitionIds = (competitionsResult.data ?? []).map((competition) => competition.id);
  const competitionNames = new Map((competitionsResult.data ?? []).map((competition) => [competition.id, competition.name]));
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
    const deadline = getLeagueFixtureDeadline(match.scheduled_for, competitionNames.get(match.competition_id));
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
      competitionId: match.competition_id,
      competitionName: competitionNames.get(match.competition_id) || "League",
      week: match.round_no ?? 1,
      scheduledFor: match.scheduled_for,
      deadline: getLeagueFixtureDeadline(match.scheduled_for, competitionNames.get(match.competition_id))?.toISOString() ?? null,
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

export async function POST(request: NextRequest) {
  const auth = await authorizeSuperUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null);
  const matchId = String(body?.matchId ?? "").trim();
  const requestedScheduledFor = String(body?.requestedScheduledFor ?? "").trim();
  if (!matchId || !/^\d{4}-\d{2}-\d{2}$/.test(requestedScheduledFor)) {
    return NextResponse.json({ error: "Choose a valid competition game week." }, { status: 400 });
  }

  const matchResult = await auth.client
    .from("matches")
    .select("id,competition_id,scheduled_for,status,is_archived,player1_id,player2_id")
    .eq("id", matchId)
    .maybeSingle();
  if (matchResult.error) return NextResponse.json({ error: matchResult.error.message }, { status: 400 });
  const match = matchResult.data;
  if (!match || match.is_archived || !["pending", "in_progress"].includes(match.status) || !match.scheduled_for || !match.player1_id || !match.player2_id) {
    return NextResponse.json({ error: "Only an unfinished weekly fixture can be rescheduled." }, { status: 400 });
  }
  if (match.scheduled_for === requestedScheduledFor) {
    return NextResponse.json({ error: "Choose a different game week." }, { status: 400 });
  }

  const competitionResult = await auth.client
    .from("competitions")
    .select("id,name,competition_format,league_schedule_mode,is_archived,is_completed")
    .eq("id", match.competition_id)
    .maybeSingle();
  const competition = competitionResult.data;
  if (competitionResult.error) return NextResponse.json({ error: competitionResult.error.message }, { status: 400 });
  if (!competition || competition.competition_format !== "league" || competition.league_schedule_mode === "one_day" || competition.is_archived || competition.is_completed) {
    return NextResponse.json({ error: "This competition does not use weekly game weeks." }, { status: 400 });
  }

  const targetWeekResult = await auth.client
    .from("matches")
    .select("id")
    .eq("competition_id", match.competition_id)
    .eq("is_archived", false)
    .eq("scheduled_for", requestedScheduledFor)
    .limit(1)
    .maybeSingle();
  if (targetWeekResult.error) return NextResponse.json({ error: targetWeekResult.error.message }, { status: 400 });
  const targetDeadline = getLeagueFixtureDeadline(requestedScheduledFor, competition.name);
  if (!targetWeekResult.data || !targetDeadline || targetDeadline <= new Date()) {
    return NextResponse.json({ error: "Choose a future game week from this competition." }, { status: 400 });
  }

  const approvedSubmission = await auth.client
    .from("result_submissions")
    .select("id")
    .eq("match_id", matchId)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();
  if (approvedSubmission.error) return NextResponse.json({ error: approvedSubmission.error.message }, { status: 400 });
  if (approvedSubmission.data) return NextResponse.json({ error: "This fixture already has an approved result." }, { status: 409 });

  const reviewedAt = new Date().toISOString();
  const closePending = await auth.client
    .from("league_reschedule_requests")
    .update({
      status: "rejected",
      reviewed_by_user_id: auth.user.id,
      reviewed_at: reviewedAt,
      note: "Superseded by a direct Super User deadline decision.",
    })
    .eq("match_id", matchId)
    .eq("status", "pending");
  if (closePending.error) return NextResponse.json({ error: closePending.error.message }, { status: 400 });

  const requestResult = await auth.client
    .from("league_reschedule_requests")
    .insert({
      match_id: matchId,
      competition_id: match.competition_id,
      requester_user_id: auth.user.id,
      requester_player_id: null,
      original_scheduled_for: match.scheduled_for,
      requested_scheduled_for: requestedScheduledFor,
      status: "approved",
      reviewed_by_user_id: auth.user.id,
      reviewed_at: reviewedAt,
      note: "Players given another opportunity to complete the fixture by Super User deadline decision.",
    })
    .select("id")
    .single();
  if (requestResult.error) return NextResponse.json({ error: requestResult.error.message }, { status: 400 });

  const matchUpdate = await auth.client
    .from("matches")
    .update({ scheduled_for: requestedScheduledFor, status: "pending", winner_player_id: null })
    .eq("id", matchId);
  if (matchUpdate.error) {
    await auth.client.from("league_reschedule_requests").delete().eq("id", requestResult.data.id);
    return NextResponse.json({ error: matchUpdate.error.message }, { status: 400 });
  }

  const [framesResult, submissionsResult] = await Promise.all([
    auth.client.from("frames").delete().eq("match_id", matchId),
    auth.client
      .from("result_submissions")
      .update({
        status: "rejected",
        reviewed_by_user_id: auth.user.id,
        reviewed_at: reviewedAt,
        note: "Fixture rescheduled by the Super User so the match can be played.",
      })
      .eq("match_id", matchId)
      .eq("status", "pending"),
  ]);
  if (framesResult.error || submissionsResult.error) {
    return NextResponse.json({ error: framesResult.error?.message || submissionsResult.error?.message }, { status: 400 });
  }

  await auth.client.from("audit_logs").insert({
    actor_user_id: auth.user.id,
    actor_email: auth.user.email ?? null,
    actor_role: auth.role,
    action: "league_fixture_rescheduled_by_deadline_decision",
    entity_type: "match",
    entity_id: matchId,
    summary: `Fixture rescheduled from ${match.scheduled_for} to ${requestedScheduledFor} to give the players another chance to play.`,
    meta: {
      competition_id: match.competition_id,
      original_scheduled_for: match.scheduled_for,
      requested_scheduled_for: requestedScheduledFor,
    },
  });

  const participantUsers = await auth.client
    .from("app_users")
    .select("id")
    .in("linked_player_id", [match.player1_id, match.player2_id]);
  if (!participantUsers.error) {
    await sendPushToUserIds(auth.client, (participantUsers.data ?? []).map((user) => user.id), {
      title: "Fixture rescheduled",
      body: `${competition.name}: your fixture has moved to the game week beginning ${new Date(`${requestedScheduledFor}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.`,
      url: `/matches/${matchId}`,
      tag: `fixture-rescheduled-${matchId}`,
    });
  }

  return NextResponse.json({ ok: true, requestedScheduledFor });
}
