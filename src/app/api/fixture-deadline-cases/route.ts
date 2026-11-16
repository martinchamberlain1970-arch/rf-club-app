import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildLeagueFixtureAnchorMap, getLeagueFixtureEffectiveFinalDeadline, getLeagueFixtureWalkoverReviewUntil } from "@/lib/league-deadline";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeadlineMatch = {
  id: string;
  competition_id: string;
  player1_id: string | null;
  player2_id: string | null;
  scheduled_for: string | null;
  status: string;
  is_archived: boolean | null;
};

type DeadlineCompetition = {
  id: string;
  name: string;
  competition_format: string;
  league_schedule_mode: string | null;
  is_archived: boolean | null;
  is_completed: boolean | null;
};

async function authorize(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) return { error: "Server is not configured.", status: 500 } as const;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Unauthorized.", status: 401 } as const;
  const authClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await authClient.auth.getUser(token);
  if (!userResult.data.user) return { error: "Unauthorized.", status: 401 } as const;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const appUserResult = await admin.from("app_users").select("id,linked_player_id,role").eq("id", userResult.data.user.id).maybeSingle();
  if (!appUserResult.data) return { error: "Your account is not linked to a player profile.", status: 403 } as const;
  return { admin, user: userResult.data.user, appUser: appUserResult.data } as const;
}

async function loadContext(admin: SupabaseClient, matchId: string) {
  const matchResult = await admin.from("matches").select("id,competition_id,player1_id,player2_id,scheduled_for,status,is_archived").eq("id", matchId).maybeSingle();
  if (matchResult.error || !matchResult.data) return { error: matchResult.error?.message ?? "Fixture not found." } as const;
  const match = matchResult.data as unknown as DeadlineMatch;
  const competitionResult = await admin.from("competitions").select("id,name,competition_format,league_schedule_mode,is_archived,is_completed").eq("id", match.competition_id).maybeSingle();
  if (competitionResult.error || !competitionResult.data) return { error: competitionResult.error?.message ?? "Competition not found." } as const;
  return { match, competition: competitionResult.data as unknown as DeadlineCompetition } as const;
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const matchId = request.nextUrl.searchParams.get("matchId")?.trim() ?? "";
  if (!UUID_PATTERN.test(matchId)) return NextResponse.json({ error: "A valid fixture is required." }, { status: 400 });
  const context = await loadContext(auth.admin, matchId);
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: 404 });
  const { match, competition } = context;
  const participant = auth.appUser.linked_player_id === match.player1_id || auth.appUser.linked_player_id === match.player2_id;
  const manager = ["admin", "owner"].includes(String(auth.appUser.role ?? ""));
  if (!participant && !manager) return NextResponse.json({ error: "You cannot view this fixture deadline case." }, { status: 403 });
  const eventsResult = await auth.admin
    .from("audit_logs")
    .select("id,action,meta,created_at")
    .eq("entity_type", "match")
    .eq("entity_id", matchId)
    .eq("action", "fixture_deadline_review_opened")
    .order("created_at", { ascending: false });
  if (eventsResult.error) return NextResponse.json({ error: eventsResult.error.message }, { status: 400 });
  const openedEvent = (eventsResult.data ?? []).find((event) => event.action === "fixture_deadline_review_opened");
  const approvedReschedules = await auth.admin.from("league_reschedule_requests").select("match_id,original_scheduled_for,created_at").eq("match_id", matchId).eq("status", "approved").order("created_at", { ascending: true });
  const deadlineException = await auth.admin.from("league_fixture_deadline_exceptions").select("extended_until").eq("match_id", matchId).eq("is_active", true).maybeSingle();
  if (approvedReschedules.error || deadlineException.error) return NextResponse.json({ error: approvedReschedules.error?.message ?? deadlineException.error?.message }, { status: 400 });
  const deadlineScheduledFor = buildLeagueFixtureAnchorMap(approvedReschedules.data ?? []).get(matchId) ?? match.scheduled_for;
  const finalDeadline = getLeagueFixtureEffectiveFinalDeadline(deadlineScheduledFor, competition.name, deadlineException.data?.extended_until ?? null)?.toISOString() ?? null;
  const reviewUntil = getLeagueFixtureWalkoverReviewUntil(deadlineScheduledFor, competition.name, deadlineException.data?.extended_until ?? null)?.toISOString() ?? null;
  const deadlineCase = openedEvent
    ? { id: openedEvent.id, status: "pending_evidence", final_deadline: finalDeadline, review_until: reviewUntil, evidence_note: null, evidence_submitted_at: null }
    : null;
  return NextResponse.json({
    case: deadlineCase,
    firstNamedPlayerId: match.player1_id,
    finalDeadline,
    claimWindowOpens: finalDeadline,
    reviewUntil,
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({
    error: "Scheduling evidence is no longer used for deadline outcomes. Record the result or submit a valid reschedule within the four-week playing window.",
  }, { status: 410 });
}
