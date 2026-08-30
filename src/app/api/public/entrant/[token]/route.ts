import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tryAutoApproveMatchingResult } from "@/lib/result-auto-approval";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
type RouteContext = { params: Promise<{ token: string }> };

function serverClient() {
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function resolveEntrant(token: string) {
  const client = serverClient();
  if (!client || !/^[0-9a-f-]{36}$/i.test(token)) return null;
  const entryResult = await client
    .from("competition_entries")
    .select("id,competition_id,player_id,public_signup_id,status")
    .eq("fixture_access_token", token)
    .maybeSingle();
  const entry = entryResult.data;
  if (!entry || entry.status !== "approved") return null;
  const playerResult = await client.from("players").select("display_name,full_name").eq("id", entry.player_id).maybeSingle();
  if (!playerResult.data) return null;
  return {
    client,
    entry,
    entrantName: playerResult.data.full_name?.trim() || playerResult.data.display_name,
  };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const resolved = await resolveEntrant(token);
  if (!resolved) return NextResponse.json({ error: "This private fixture link is not valid or the entry has not yet been approved." }, { status: 404 });
  const { client, entry, entrantName } = resolved;
  const [competitionResult, matchesResult, entriesResult] = await Promise.all([
    client.from("competitions").select("id,name,venue,sport_type,competition_format,best_of").eq("id", entry.competition_id).maybeSingle(),
    client
      .from("matches")
      .select("id,round_no,match_no,best_of,status,player1_id,player2_id,winner_player_id,opening_break_player_id,scheduled_for")
      .eq("competition_id", entry.competition_id)
      .eq("is_archived", false)
      .or(`player1_id.eq.${entry.player_id},player2_id.eq.${entry.player_id}`)
      .order("round_no")
      .order("match_no"),
    client.from("competition_entries").select("id,player_id,public_signup_id").eq("competition_id", entry.competition_id).eq("status", "approved"),
  ]);
  if (!competitionResult.data || competitionResult.error || matchesResult.error || entriesResult.error) {
    return NextResponse.json({ error: competitionResult.error?.message || matchesResult.error?.message || entriesResult.error?.message || "Fixtures could not be loaded." }, { status: 400 });
  }

  const entries = entriesResult.data ?? [];
  const playerIds = entries.map((item) => item.player_id);
  const signupIds = entries.map((item) => item.public_signup_id).filter(Boolean) as string[];
  const matchIds = (matchesResult.data ?? []).map((match) => match.id);
  const [playersResult, contactsResult, signupsResult, usersResult, submissionsResult] = await Promise.all([
    client.from("players").select("id,display_name,full_name").in("id", playerIds),
    client.from("competition_entry_contacts").select("competition_entry_id,email,phone").in("competition_entry_id", entries.map((item) => item.id)),
    signupIds.length ? client.from("public_competition_signups").select("id,email,phone").in("id", signupIds) : Promise.resolve({ data: [], error: null }),
    client.from("app_users").select("linked_player_id,email").in("linked_player_id", playerIds),
    matchIds.length
      ? client.from("result_submissions").select("id,match_id,competition_entry_id,status,submitted_at,team1_score,team2_score").in("match_id", matchIds).order("submitted_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const loadError = playersResult.error || contactsResult.error || signupsResult.error || usersResult.error || submissionsResult.error;
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 400 });

  const players = new Map((playersResult.data ?? []).map((player) => [player.id, player]));
  const entryByPlayer = new Map(entries.map((item) => [item.player_id, item]));
  const contacts = new Map((contactsResult.data ?? []).map((contact) => [contact.competition_entry_id, contact]));
  const signups = new Map((signupsResult.data ?? []).map((item) => [item.id, item]));
  const userEmails = new Map((usersResult.data ?? []).map((user) => [user.linked_player_id, user.email]));
  type SubmissionRow = { id: string; match_id: string; competition_entry_id: string | null; status: "pending" | "approved" | "rejected"; submitted_at: string; team1_score: number; team2_score: number };
  const latestByMatchAndEntry = new Map<string, SubmissionRow>();
  for (const submission of (submissionsResult.data ?? []) as SubmissionRow[]) {
    if (!submission.competition_entry_id) continue;
    const key = `${submission.match_id}:${submission.competition_entry_id}`;
    if (!latestByMatchAndEntry.has(key)) latestByMatchAndEntry.set(key, submission);
  }

  const fixtures = (matchesResult.data ?? []).map((match) => {
    const entrantIsPlayer1 = match.player1_id === entry.player_id;
    const opponentId = entrantIsPlayer1 ? match.player2_id : match.player1_id;
    const opponentEntry = opponentId ? entryByPlayer.get(opponentId) : null;
    const override = opponentEntry ? contacts.get(opponentEntry.id) : null;
    const opponentSignup = opponentEntry?.public_signup_id ? signups.get(opponentEntry.public_signup_id) : null;
    const opponent = opponentId ? players.get(opponentId) : null;
    const ownSubmission = latestByMatchAndEntry.get(`${match.id}:${entry.id}`) ?? null;
    const opponentSubmission = opponentEntry ? latestByMatchAndEntry.get(`${match.id}:${opponentEntry.id}`) ?? null : null;
    const bothPending = ownSubmission?.status === "pending" && opponentSubmission?.status === "pending";
    const comparison = !ownSubmission || ownSubmission.status !== "pending"
      ? null
      : !opponentSubmission || opponentSubmission.status !== "pending"
        ? "waiting"
        : ownSubmission.team1_score === opponentSubmission.team1_score && ownSubmission.team2_score === opponentSubmission.team2_score
          ? "agreed"
          : "disputed";
    return {
      id: match.id,
      roundNo: match.round_no,
      matchNo: match.match_no,
      bestOf: match.best_of,
      status: match.status,
      scheduledFor: match.scheduled_for,
      openingBreaker: match.opening_break_player_id
        ? players.get(match.opening_break_player_id)?.full_name?.trim() || players.get(match.opening_break_player_id)?.display_name || "Assigned player"
        : null,
      entrantBreaksFirst: match.opening_break_player_id === entry.player_id,
      opponent: {
        name: opponent?.full_name?.trim() || opponent?.display_name || "Opponent to be confirmed",
        email: override?.email || opponentSignup?.email || (opponentId ? userEmails.get(opponentId) : null) || null,
        phone: override?.phone || opponentSignup?.phone || null,
      },
      outcome: match.status === "complete" ? (match.winner_player_id ? (match.winner_player_id === entry.player_id ? "won" : "lost") : "void") : null,
      submission: ownSubmission ? {
        status: ownSubmission.status,
        submittedAt: ownSubmission.submitted_at,
        entrantScore: entrantIsPlayer1 ? ownSubmission.team1_score : ownSubmission.team2_score,
        opponentScore: entrantIsPlayer1 ? ownSubmission.team2_score : ownSubmission.team1_score,
      } : null,
      comparison,
      opponentSubmission: bothPending && opponentSubmission ? {
        entrantScore: entrantIsPlayer1 ? opponentSubmission.team1_score : opponentSubmission.team2_score,
        opponentScore: entrantIsPlayer1 ? opponentSubmission.team2_score : opponentSubmission.team1_score,
      } : null,
    };
  });
  return NextResponse.json({ entrant: { name: entrantName }, competition: competitionResult.data, fixtures });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const resolved = await resolveEntrant(token);
  if (!resolved) return NextResponse.json({ error: "This private fixture link is not valid or the entry has not yet been approved." }, { status: 404 });
  const body = await request.json().catch(() => null);
  const matchId = String(body?.matchId ?? "");
  const entrantScore = Number(body?.entrantScore);
  const opponentScore = Number(body?.opponentScore);
  if (!matchId || !Number.isInteger(entrantScore) || !Number.isInteger(opponentScore) || entrantScore < 0 || opponentScore < 0) {
    return NextResponse.json({ error: "Enter a valid whole-number score for both players." }, { status: 400 });
  }
  const { client, entry } = resolved;
  const matchResult = await client
    .from("matches")
    .select("id,competition_id,best_of,status,player1_id,player2_id")
    .eq("id", matchId)
    .eq("competition_id", entry.competition_id)
    .eq("is_archived", false)
    .maybeSingle();
  const match = matchResult.data;
  if (!match || (match.player1_id !== entry.player_id && match.player2_id !== entry.player_id)) return NextResponse.json({ error: "Fixture not found." }, { status: 404 });
  if (!["pending", "in_progress"].includes(match.status)) return NextResponse.json({ error: "This fixture is no longer open for a result." }, { status: 409 });
  if (entrantScore > match.best_of || opponentScore > match.best_of) {
    return NextResponse.json({ error: `Neither player can be awarded more than ${match.best_of} racks.` }, { status: 400 });
  }
  if (entrantScore + opponentScore !== match.best_of || entrantScore === opponentScore) {
    return NextResponse.json({ error: `Play all ${match.best_of} racks. The two scores must total exactly ${match.best_of}.` }, { status: 400 });
  }
  const pendingResult = await client.from("result_submissions").select("id").eq("match_id", match.id).eq("competition_entry_id", entry.id).eq("status", "pending").maybeSingle();
  if (pendingResult.data) return NextResponse.json({ error: "You already have a result awaiting comparison or approval for this fixture." }, { status: 409 });
  const entrantIsPlayer1 = match.player1_id === entry.player_id;
  const insertResult = await client.from("result_submissions").insert({
    match_id: match.id,
    submitted_by_user_id: null,
    public_signup_id: entry.public_signup_id,
    competition_entry_id: entry.id,
    team1_score: entrantIsPlayer1 ? entrantScore : opponentScore,
    team2_score: entrantIsPlayer1 ? opponentScore : entrantScore,
    break_and_run: false,
    run_out_against_break: false,
    break_and_run_team1: 0,
    break_and_run_team2: 0,
    run_out_against_break_team1: 0,
    run_out_against_break_team2: 0,
    status: "pending",
  }).select("id,submitted_at").single();
  if (insertResult.error) return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
  await client.from("matches").update({ status: "in_progress" }).eq("id", match.id).eq("status", "pending");
  const comparison = await tryAutoApproveMatchingResult(client, match.id);
  return NextResponse.json({ ok: true, submittedAt: insertResult.data.submitted_at, autoApproved: comparison.autoApproved === true });
}
