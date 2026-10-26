import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLeagueFixtureFinalDeadline, getLeagueFixtureWalkoverReviewUntil } from "@/lib/league-deadline";
import { sendPushToUserIds } from "@/lib/push-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;

type MatchRow = { id: string; competition_id: string; scheduled_for: string | null; status: "pending" | "in_progress"; player1_id: string | null; player2_id: string | null; best_of: number; owner_user_id: string | null };

export async function GET(req: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "");
  const isAuthorized = cronSecret ? authHeader === cronSecret : Boolean(req.headers.get("x-vercel-cron"));
  if (!isAuthorized) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const competitionsResult = await client.from("competitions").select("id,name,sport_type").eq("competition_format", "league").neq("league_schedule_mode", "one_day").eq("is_archived", false).eq("is_completed", false);
  if (competitionsResult.error) return NextResponse.json({ error: competitionsResult.error.message }, { status: 400 });
  const competitions = new Map((competitionsResult.data ?? []).map((row) => [row.id as string, row]));
  if (!competitions.size) return NextResponse.json({ ok: true, opened: [], awarded: [] });

  const matchesResult = await client.from("matches").select("id,competition_id,scheduled_for,status,player1_id,player2_id,best_of,owner_user_id").in("competition_id", [...competitions.keys()]).eq("is_archived", false).in("status", ["pending", "in_progress"]);
  if (matchesResult.error) return NextResponse.json({ error: matchesResult.error.message }, { status: 400 });
  const matches = (matchesResult.data ?? []) as MatchRow[];
  if (!matches.length) return NextResponse.json({ ok: true, opened: [], awarded: [] });

  const matchIds = matches.map((match) => match.id);
  const [submissionsResult, deadlineEventsResult] = await Promise.all([
    client.from("result_submissions").select("match_id,status").in("match_id", matchIds).in("status", ["pending", "approved"]),
    client.from("audit_logs").select("entity_id,action,created_at").eq("entity_type", "match").in("entity_id", matchIds).in("action", ["fixture_deadline_review_opened", "fixture_deadline_evidence_submitted", "fixture_deadline_walkover_awarded"]),
  ]);
  if (submissionsResult.error || deadlineEventsResult.error) return NextResponse.json({ error: submissionsResult.error?.message ?? deadlineEventsResult.error?.message }, { status: 400 });
  const protectedMatchIds = new Set((submissionsResult.data ?? []).map((row) => row.match_id as string));
  const actionsByMatch = new Map<string, Set<string>>();
  for (const event of deadlineEventsResult.data ?? []) {
    const matchId = String(event.entity_id ?? "");
    const actions = actionsByMatch.get(matchId) ?? new Set<string>();
    actions.add(String(event.action));
    actionsByMatch.set(matchId, actions);
  }
  const now = new Date();
  const opened: string[] = [];
  const awarded: string[] = [];

  for (const match of matches) {
    if (!match.player1_id || !match.player2_id || match.player1_id === match.player2_id || protectedMatchIds.has(match.id)) continue;
    const competition = competitions.get(match.competition_id);
    if (!competition) continue;
    const finalDeadline = getLeagueFixtureFinalDeadline(match.scheduled_for, competition.name);
    const reviewUntil = getLeagueFixtureWalkoverReviewUntil(match.scheduled_for, competition.name);
    if (!finalDeadline || !reviewUntil || now <= finalDeadline) continue;
    const deadlineActions = actionsByMatch.get(match.id) ?? new Set<string>();
    if (!deadlineActions.has("fixture_deadline_review_opened")) {
      const insert = await client.from("audit_logs").insert({
        actor_user_id: null,
        actor_email: null,
        actor_role: "system",
        action: "fixture_deadline_review_opened",
        entity_type: "match",
        entity_id: match.id,
        summary: "The four-week playing window closed and the 24-hour walkover review opened.",
        meta: { competition_id: match.competition_id, final_deadline: finalDeadline.toISOString(), review_until: reviewUntil.toISOString(), default_winner_player_id: match.player2_id },
      });
      if (insert.error) continue;
      deadlineActions.add("fixture_deadline_review_opened");
      actionsByMatch.set(match.id, deadlineActions);
      opened.push(match.id);
      const participants = await client.from("app_users").select("id").in("linked_player_id", [match.player1_id, match.player2_id]);
      if (!participants.error) await sendPushToUserIds(client, (participants.data ?? []).map((row) => row.id), { title: "Fixture walkover review", body: `${competition.name}: the playing window has closed. The first-named player has 24 hours to ensure any scheduling evidence is recorded before the default walkover is confirmed.`, url: `/matches/${match.id}`, tag: `fixture-deadline-${match.id}` });
    }
    if (deadlineActions.has("fixture_deadline_evidence_submitted") || deadlineActions.has("fixture_deadline_walkover_awarded") || now <= reviewUntil) continue;

    let ownerUserId = match.owner_user_id;
    if (!ownerUserId) {
      const linked = await client.from("app_users").select("id").eq("linked_player_id", match.player2_id).limit(1).maybeSingle();
      ownerUserId = linked.data?.id ?? null;
    }
    if (!ownerUserId) continue;
    const awardedCount = competition.sport_type === "snooker" ? 1 : Math.max(1, Number(match.best_of ?? 1));
    const clearFrames = await client.from("frames").delete().eq("match_id", match.id);
    if (clearFrames.error) continue;
    const frameInsert = await client.from("frames").insert(Array.from({ length: awardedCount }, (_, index) => ({ match_id: match.id, frame_number: index + 1, owner_user_id: ownerUserId, winner_player_id: match.player2_id, break_and_run: false, run_out_against_break: false, is_walkover_award: true, team1_points: 0, team2_points: 0, breaks_over_30_team1_values: [], breaks_over_30_team2_values: [], breaks_over_30_team1: 0, breaks_over_30_team2: 0, high_break_team1: 0, high_break_team2: 0 })));
    if (frameInsert.error) continue;
    const matchUpdate = await client.from("matches").update({ status: "complete", winner_player_id: match.player2_id }).eq("id", match.id).in("status", ["pending", "in_progress"]);
    if (matchUpdate.error) continue;
    await client.from("audit_logs").insert({
      actor_user_id: null,
      actor_email: null,
      actor_role: "system",
      action: "fixture_deadline_walkover_awarded",
      entity_type: "match",
      entity_id: match.id,
      summary: "The overdue fixture was awarded to the second-named player after the review period closed.",
      meta: { competition_id: match.competition_id, winner_player_id: match.player2_id },
    });
    awarded.push(match.id);
    const participants = await client.from("app_users").select("id").in("linked_player_id", [match.player1_id, match.player2_id]);
    if (!participants.error) await sendPushToUserIds(client, (participants.data ?? []).map((row) => row.id), { title: "Fixture awarded by walkover", body: `${competition.name}: the unplayed fixture has been awarded to the second-named player after the evidence period closed.`, url: `/matches/${match.id}`, tag: `fixture-awarded-${match.id}` });
  }

  return NextResponse.json({ ok: true, opened, awarded });
}
