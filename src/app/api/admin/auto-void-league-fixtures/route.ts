import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getLeagueFixtureDeadline(scheduledFor: string | null | undefined) {
  if (!scheduledFor) return null;
  const [year, month, day] = scheduledFor.split("-").map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day + 6, 21, 0, 0, 0);
}

export async function POST(req: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const competitionId = typeof body?.competitionId === "string" ? body.competitionId : "";
  if (!competitionId) {
    return NextResponse.json({ error: "Competition id is required." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const competitionRes = await adminClient
    .from("competitions")
    .select("id,name,competition_format")
    .eq("id", competitionId)
    .maybeSingle();

  if (competitionRes.error || !competitionRes.data) {
    return NextResponse.json({ error: competitionRes.error?.message ?? "Competition not found." }, { status: 404 });
  }
  if (competitionRes.data.competition_format !== "league") {
    return NextResponse.json({ ok: true, voidedMatchIds: [] });
  }

  const matchesRes = await adminClient
    .from("matches")
    .select("id,scheduled_for,status,winner_player_id")
    .eq("competition_id", competitionId)
    .eq("is_archived", false)
    .in("status", ["pending", "in_progress"]);

  if (matchesRes.error) {
    return NextResponse.json({ error: matchesRes.error.message }, { status: 400 });
  }

  const matches = (matchesRes.data ?? []) as Array<{
    id: string;
    scheduled_for: string | null;
    status: "pending" | "in_progress";
    winner_player_id: string | null;
  }>;
  if (!matches.length) {
    return NextResponse.json({ ok: true, voidedMatchIds: [] });
  }

  const matchIds = matches.map((match) => match.id);
  const submissionRes = await adminClient
    .from("result_submissions")
    .select("id,match_id,status")
    .in("match_id", matchIds);
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
  const overdueMatchIds = matches
    .filter((match) => {
      const deadline = getLeagueFixtureDeadline(match.scheduled_for);
      if (!deadline || now <= deadline) return false;
      const submissions = submissionsByMatch.get(match.id) ?? [];
      return !submissions.some((submission) => submission.status === "pending" || submission.status === "approved");
    })
    .map((match) => match.id);

  if (!overdueMatchIds.length) {
    return NextResponse.json({ ok: true, voidedMatchIds: [] });
  }

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
      reviewed_by_user_id: authData.user.id,
      reviewed_at: new Date().toISOString(),
      note: "Fixture auto-voided after deadline without a submitted result.",
    })
    .in("match_id", overdueMatchIds)
    .neq("status", "rejected");
  if (submissionUpdateRes.error) {
    return NextResponse.json({ error: submissionUpdateRes.error.message }, { status: 400 });
  }

  await adminClient.from("audit_logs").insert({
    actor_user_id: authData.user.id,
    actor_email: authData.user.email ?? null,
    actor_role: "system",
    action: "league_fixture_auto_voided",
    entity_type: "competition",
    entity_id: competitionId,
    summary: `Auto-voided ${overdueMatchIds.length} overdue league fixture${overdueMatchIds.length === 1 ? "" : "s"}.`,
    meta: { voidedMatchIds: overdueMatchIds },
  });

  return NextResponse.json({ ok: true, voidedMatchIds: overdueMatchIds });
}
