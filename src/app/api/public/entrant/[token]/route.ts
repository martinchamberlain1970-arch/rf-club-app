import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  const signupResult = await client
    .from("public_competition_signups")
    .select("id,competition_id,full_name,email,phone,status")
    .eq("fixture_access_token", token)
    .maybeSingle();
  if (!signupResult.data || signupResult.data.status !== "added") return null;
  const entryResult = await client
    .from("competition_entries")
    .select("id,player_id,status")
    .eq("public_signup_id", signupResult.data.id)
    .eq("competition_id", signupResult.data.competition_id)
    .maybeSingle();
  if (!entryResult.data || entryResult.data.status !== "approved") return null;
  return { client, signup: signupResult.data, entry: entryResult.data };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const resolved = await resolveEntrant(token);
  if (!resolved) return NextResponse.json({ error: "This private fixture link is not valid or the entry has not yet been approved." }, { status: 404 });
  const { client, signup, entry } = resolved;
  const [competitionResult, matchesResult, entriesResult] = await Promise.all([
    client.from("competitions").select("id,name,venue,sport_type,competition_format,best_of").eq("id", signup.competition_id).maybeSingle(),
    client
      .from("matches")
      .select("id,round_no,match_no,best_of,status,player1_id,player2_id,winner_player_id,scheduled_for")
      .eq("competition_id", signup.competition_id)
      .eq("is_archived", false)
      .or(`player1_id.eq.${entry.player_id},player2_id.eq.${entry.player_id}`)
      .order("round_no")
      .order("match_no"),
    client.from("competition_entries").select("id,player_id,public_signup_id").eq("competition_id", signup.competition_id).eq("status", "approved"),
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
    matchIds.length ? client.from("result_submissions").select("id,match_id,status,submitted_at,team1_score,team2_score").eq("public_signup_id", signup.id).in("match_id", matchIds).order("submitted_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  const loadError = playersResult.error || contactsResult.error || signupsResult.error || usersResult.error || submissionsResult.error;
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 400 });

  const players = new Map((playersResult.data ?? []).map((player) => [player.id, player]));
  const entryByPlayer = new Map(entries.map((item) => [item.player_id, item]));
  const contacts = new Map((contactsResult.data ?? []).map((contact) => [contact.competition_entry_id, contact]));
  const signups = new Map((signupsResult.data ?? []).map((item) => [item.id, item]));
  const userEmails = new Map((usersResult.data ?? []).map((user) => [user.linked_player_id, user.email]));
  const latestSubmission = new Map<string, (typeof submissionsResult.data extends Array<infer T> ? T : never)>();
  for (const submission of submissionsResult.data ?? []) if (!latestSubmission.has(submission.match_id)) latestSubmission.set(submission.match_id, submission);

  const fixtures = (matchesResult.data ?? []).map((match) => {
    const entrantIsPlayer1 = match.player1_id === entry.player_id;
    const opponentId = entrantIsPlayer1 ? match.player2_id : match.player1_id;
    const opponentEntry = opponentId ? entryByPlayer.get(opponentId) : null;
    const override = opponentEntry ? contacts.get(opponentEntry.id) : null;
    const opponentSignup = opponentEntry?.public_signup_id ? signups.get(opponentEntry.public_signup_id) : null;
    const opponent = opponentId ? players.get(opponentId) : null;
    const submission = latestSubmission.get(match.id);
    return {
      id: match.id,
      roundNo: match.round_no,
      matchNo: match.match_no,
      bestOf: match.best_of,
      status: match.status,
      scheduledFor: match.scheduled_for,
      entrantIsPlayer1,
      opponent: {
        name: opponent?.full_name?.trim() || opponent?.display_name || "Opponent to be confirmed",
        email: override?.email || opponentSignup?.email || (opponentId ? userEmails.get(opponentId) : null) || null,
        phone: override?.phone || opponentSignup?.phone || null,
      },
      outcome: match.status === "complete" ? (match.winner_player_id ? (match.winner_player_id === entry.player_id ? "won" : "lost") : "void") : null,
      submission: submission ? {
        status: submission.status,
        submittedAt: submission.submitted_at,
        entrantScore: entrantIsPlayer1 ? submission.team1_score : submission.team2_score,
        opponentScore: entrantIsPlayer1 ? submission.team2_score : submission.team1_score,
      } : null,
    };
  });
  return NextResponse.json({
    entrant: { name: signup.full_name },
    competition: competitionResult.data,
    fixtures,
  });
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
    return NextResponse.json({ error: "Enter a valid whole-number score." }, { status: 400 });
  }
  const { client, signup, entry } = resolved;
  const matchResult = await client
    .from("matches")
    .select("id,competition_id,best_of,status,player1_id,player2_id")
    .eq("id", matchId)
    .eq("competition_id", signup.competition_id)
    .eq("is_archived", false)
    .maybeSingle();
  const match = matchResult.data;
  if (!match || (match.player1_id !== entry.player_id && match.player2_id !== entry.player_id)) return NextResponse.json({ error: "Fixture not found." }, { status: 404 });
  if (!['pending', 'in_progress'].includes(match.status)) return NextResponse.json({ error: "This fixture is no longer open for a result." }, { status: 409 });
  if (entrantScore + opponentScore !== match.best_of || entrantScore === opponentScore) {
    return NextResponse.json({ error: `All ${match.best_of} racks must be entered. The score must total ${match.best_of}.` }, { status: 400 });
  }
  const pendingResult = await client.from("result_submissions").select("id").eq("match_id", match.id).eq("public_signup_id", signup.id).eq("status", "pending").maybeSingle();
  if (pendingResult.data) return NextResponse.json({ error: "You already have a result awaiting approval for this fixture." }, { status: 409 });
  const entrantIsPlayer1 = match.player1_id === entry.player_id;
  const insertResult = await client.from("result_submissions").insert({
    match_id: match.id,
    submitted_by_user_id: null,
    public_signup_id: signup.id,
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
  return NextResponse.json({ ok: true, submittedAt: insertResult.data.submitted_at });
}
