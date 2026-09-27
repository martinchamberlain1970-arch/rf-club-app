import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLeagueFixtureDeadline } from "@/lib/league-deadline";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET() {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Outstanding fixtures are unavailable." }, { status: 503 });
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const competitionResult = await client
    .from("competitions")
    .select("id,name,sport_type,competition_format,is_archived")
    .eq("competition_format", "league")
    .eq("is_archived", false);
  if (competitionResult.error) {
    return NextResponse.json({ error: "Outstanding fixtures could not be loaded." }, { status: 400 });
  }

  const competitions = competitionResult.data ?? [];
  const competitionIds = competitions.map((competition) => competition.id);
  if (!competitionIds.length) {
    return NextResponse.json({ fixtures: [], updatedAt: new Date().toISOString() });
  }

  const matchResult = await client
    .from("matches")
    .select("id,competition_id,player1_id,player2_id,scheduled_for,status,round_no,match_no")
    .in("competition_id", competitionIds)
    .eq("is_archived", false)
    .in("status", ["pending", "in_progress"]);
  if (matchResult.error) {
    return NextResponse.json({ error: "Outstanding fixtures could not be loaded." }, { status: 400 });
  }

  const matches = matchResult.data ?? [];
  const matchIds = matches.map((match) => match.id);
  const playerIds = [...new Set(matches.flatMap((match) => [match.player1_id, match.player2_id]).filter((value): value is string => Boolean(value)))];
  const [playerResult, rescheduleResult, submissionResult] = await Promise.all([
    playerIds.length
      ? client.from("players").select("id,display_name,full_name").in("id", playerIds)
      : Promise.resolve({ data: [], error: null }),
    matchIds.length
      ? client.from("league_reschedule_requests").select("match_id,original_scheduled_for,requested_scheduled_for,created_at").in("match_id", matchIds).eq("status", "approved").order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    matchIds.length
      ? client.from("result_submissions").select("match_id").in("match_id", matchIds).eq("status", "pending")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (playerResult.error || rescheduleResult.error || submissionResult.error) {
    return NextResponse.json({ error: "Outstanding fixtures could not be loaded." }, { status: 400 });
  }

  const competitionById = new Map(competitions.map((competition) => [competition.id, competition]));
  const playerNameById = new Map((playerResult.data ?? []).map((player) => [player.id, player.full_name?.trim() || player.display_name]));
  const latestRescheduleByMatch = new Map<string, { original_scheduled_for: string; requested_scheduled_for: string }>();
  for (const request of rescheduleResult.data ?? []) {
    latestRescheduleByMatch.set(request.match_id, request);
  }
  const submittedMatchIds = new Set((submissionResult.data ?? []).map((submission) => submission.match_id));
  const now = Date.now();

  const fixtures = matches.flatMap((match) => {
    const competition = competitionById.get(match.competition_id);
    if (!competition || submittedMatchIds.has(match.id) || !match.player1_id || !match.player2_id || match.player1_id === match.player2_id || !match.scheduled_for) return [];
    const deadline = getLeagueFixtureDeadline(match.scheduled_for, competition.name);
    if (!deadline) return [];
    const reschedule = latestRescheduleByMatch.get(match.id) ?? null;
    const overdue = deadline.getTime() < now;
    if (!overdue && !reschedule) return [];
    return [{
      competitionId: competition.id,
      competitionName: competition.name,
      sportType: competition.sport_type,
      playerOne: playerNameById.get(match.player1_id) || "Player",
      playerTwo: playerNameById.get(match.player2_id) || "Player",
      scheduledFor: match.scheduled_for,
      deadline: deadline.toISOString(),
      week: match.round_no ?? null,
      matchNo: match.match_no ?? null,
      status: match.status,
      overdue,
      originalScheduledFor: reschedule?.original_scheduled_for ?? null,
      rescheduledTo: reschedule?.requested_scheduled_for ?? null,
    }];
  }).sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime() || a.competitionName.localeCompare(b.competitionName));

  return NextResponse.json(
    { fixtures, updatedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } }
  );
}
