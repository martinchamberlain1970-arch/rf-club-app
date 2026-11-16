import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildLeagueFixtureAnchorMap, buildLeagueFixtureDeadlineExceptionMap, getLeagueFixtureEffectiveFinalDeadline } from "@/lib/league-deadline";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    .select("id,name,competition_format,league_schedule_mode")
    .eq("id", competitionId)
    .maybeSingle();

  if (competitionRes.error || !competitionRes.data) {
    return NextResponse.json({ error: competitionRes.error?.message ?? "Competition not found." }, { status: 404 });
  }
  const competition = competitionRes.data;
  if (competition.competition_format !== "league" || competition.league_schedule_mode === "one_day") {
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
  const [submissionRes, rescheduleRes, exceptionRes] = await Promise.all([
    adminClient.from("result_submissions").select("id,match_id,status").in("match_id", matchIds),
    adminClient.from("league_reschedule_requests").select("match_id,original_scheduled_for,created_at").in("match_id", matchIds).eq("status", "approved").order("created_at", { ascending: true }),
    adminClient.from("league_fixture_deadline_exceptions").select("match_id,extended_until,is_active").in("match_id", matchIds).eq("is_active", true),
  ]);
  if (submissionRes.error || rescheduleRes.error || exceptionRes.error) {
    return NextResponse.json({ error: submissionRes.error?.message ?? rescheduleRes.error?.message ?? exceptionRes.error?.message }, { status: 400 });
  }
  const deadlineAnchorByMatch = buildLeagueFixtureAnchorMap(rescheduleRes.data ?? []);
  const deadlineExceptionByMatch = buildLeagueFixtureDeadlineExceptionMap(exceptionRes.data ?? []);

  const submissionsByMatch = new Map<string, Array<{ id: string; status: "pending" | "approved" | "rejected" }>>();
  for (const submission of (submissionRes.data ?? []) as Array<{ id: string; match_id: string; status: "pending" | "approved" | "rejected" }>) {
    const prev = submissionsByMatch.get(submission.match_id) ?? [];
    prev.push(submission);
    submissionsByMatch.set(submission.match_id, prev);
  }

  const now = new Date();
  const reviewMatchIds = matches
    .filter((match) => {
      const deadline = getLeagueFixtureEffectiveFinalDeadline(deadlineAnchorByMatch.get(match.id) ?? match.scheduled_for, competition.name, deadlineExceptionByMatch.get(match.id) ?? null);
      if (!deadline || now <= deadline) return false;
      const submissions = submissionsByMatch.get(match.id) ?? [];
      return !submissions.some((submission) => submission.status === "approved");
    })
    .map((match) => match.id);

  // The deadline now creates an organiser decision rather than changing the
  // result automatically. A single submission remains available to approve;
  // a fixture with no submission can be awarded or voided by the Super User.
  return NextResponse.json({ ok: true, voidedMatchIds: [], reviewMatchIds });
}
