import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getLeagueFixtureClaimWindowOpens, getLeagueFixtureFinalDeadline, getLeagueFixtureWalkoverReviewUntil } from "@/lib/league-deadline";
import { sendPushToUserIds } from "@/lib/push-server";

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
    .in("action", ["fixture_deadline_review_opened", "fixture_deadline_evidence_submitted"])
    .order("created_at", { ascending: false });
  if (eventsResult.error) return NextResponse.json({ error: eventsResult.error.message }, { status: 400 });
  const evidenceEvent = (eventsResult.data ?? []).find((event) => event.action === "fixture_deadline_evidence_submitted");
  const openedEvent = (eventsResult.data ?? []).find((event) => event.action === "fixture_deadline_review_opened");
  const finalDeadline = getLeagueFixtureFinalDeadline(match.scheduled_for, competition.name)?.toISOString() ?? null;
  const reviewUntil = getLeagueFixtureWalkoverReviewUntil(match.scheduled_for, competition.name)?.toISOString() ?? null;
  const deadlineCase = evidenceEvent
    ? {
        id: evidenceEvent.id,
        status: "evidence_submitted",
        final_deadline: finalDeadline,
        review_until: reviewUntil,
        evidence_note: typeof evidenceEvent.meta?.evidence_note === "string" ? evidenceEvent.meta.evidence_note : null,
        evidence_submitted_at: evidenceEvent.created_at,
      }
    : openedEvent
      ? { id: openedEvent.id, status: "pending_evidence", final_deadline: finalDeadline, review_until: reviewUntil, evidence_note: null, evidence_submitted_at: null }
      : null;
  return NextResponse.json({
    case: deadlineCase,
    firstNamedPlayerId: match.player1_id,
    finalDeadline,
    claimWindowOpens: getLeagueFixtureClaimWindowOpens(match.scheduled_for, competition.name)?.toISOString() ?? null,
    reviewUntil: getLeagueFixtureWalkoverReviewUntil(match.scheduled_for, competition.name)?.toISOString() ?? null,
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const matchId = String(body?.matchId ?? "").trim();
  const evidenceNote = String(body?.evidenceNote ?? "").trim();
  if (!UUID_PATTERN.test(matchId) || evidenceNote.length < 10 || evidenceNote.length > 1000) {
    return NextResponse.json({ error: "Explain your attempts to arrange the fixture in between 10 and 1,000 characters." }, { status: 400 });
  }
  const context = await loadContext(auth.admin, matchId);
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: 404 });
  const { match, competition } = context;
  if (competition.competition_format !== "league" || competition.league_schedule_mode === "one_day" || match.is_archived || match.status === "complete" || !match.player1_id || !match.player2_id || match.player1_id === match.player2_id) {
    return NextResponse.json({ error: "This fixture is not eligible for an overdue-fixture claim." }, { status: 409 });
  }
  if (auth.appUser.linked_player_id !== match.player1_id) {
    return NextResponse.json({ error: "Only the first-named player can lodge evidence under this rule." }, { status: 403 });
  }
  const claimWindowOpens = getLeagueFixtureClaimWindowOpens(match.scheduled_for, competition.name);
  const finalDeadline = getLeagueFixtureFinalDeadline(match.scheduled_for, competition.name);
  const reviewUntil = getLeagueFixtureWalkoverReviewUntil(match.scheduled_for, competition.name);
  if (!claimWindowOpens || !finalDeadline || !reviewUntil || new Date() < claimWindowOpens || new Date() > reviewUntil) {
    return NextResponse.json({ error: "Evidence can be lodged from the Sunday before the fixture becomes overdue until the 24-hour review period closes." }, { status: 409 });
  }
  const now = new Date().toISOString();
  const existingEvidence = await auth.admin.from("audit_logs").select("id,created_at").eq("entity_type", "match").eq("entity_id", match.id).eq("action", "fixture_deadline_evidence_submitted").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existingEvidence.error) return NextResponse.json({ error: existingEvidence.error.message }, { status: 400 });

  const managers = await auth.admin.from("app_users").select("id").in("role", ["admin", "owner"]);
  if (!managers.error) await sendPushToUserIds(auth.admin, (managers.data ?? []).map((row) => row.id), {
    title: "Overdue fixture evidence submitted",
    body: `${competition.name}: the first-named player has submitted evidence for organiser review.`,
    url: `/matches/${match.id}`,
    tag: `fixture-evidence-${match.id}`,
  });
  let savedEvidence = existingEvidence.data;
  if (!savedEvidence) {
    const insert = await auth.admin.from("audit_logs").insert({
      actor_user_id: auth.user.id,
      actor_email: auth.user.email ?? null,
      actor_role: String(auth.appUser.role ?? "user"),
      action: "fixture_deadline_evidence_submitted",
      entity_type: "match",
      entity_id: match.id,
      summary: "First-named player submitted evidence of attempts to arrange an overdue fixture.",
      meta: { competition_id: match.competition_id, evidence_note: evidenceNote },
    }).select("id,created_at").single();
    if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 400 });
    savedEvidence = insert.data;
  }
  return NextResponse.json({ ok: true, case: { id: savedEvidence?.id, status: "evidence_submitted", evidence_submitted_at: savedEvidence?.created_at ?? now } });
}
