import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { brandedEmail, escapeEmailHtml } from "@/lib/email-template";
import { getLeagueFixtureDeadline, getLeagueFixtureFinalDeadline } from "@/lib/league-deadline";
import { hasMailerConfig, sendEmail } from "@/lib/mailer";
import { sendPushToUserIds } from "@/lib/push-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;
const DAY_MS = 24 * 60 * 60 * 1000;

type ReminderPhase = "overdue" | "final";
type MatchRow = {
  id: string;
  competition_id: string;
  player1_id: string;
  player2_id: string;
  scheduled_for: string;
};

function formatDeadline(value: Date) {
  return value.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function phaseAction(phase: ReminderPhase) {
  return `fixture_reminder_auto_${phase}`;
}

function choosePhase(now: Date, match: MatchRow, competitionName: string): ReminderPhase | null {
  const originalDeadline = getLeagueFixtureDeadline(match.scheduled_for, competitionName);
  const finalDeadline = getLeagueFixtureFinalDeadline(match.scheduled_for, competitionName);
  if (!originalDeadline || !finalDeadline || now >= finalDeadline) return null;
  if (now >= new Date(finalDeadline.getTime() - 7 * DAY_MS)) return "final";
  if (now > originalDeadline) return "overdue";
  return null;
}

async function sendFixtureReminder(
  client: SupabaseClient,
  match: MatchRow,
  competitionName: string,
  phase: ReminderPhase,
  originalDeadline: Date,
  finalDeadline: Date
) {
  const participantIds = [match.player1_id, match.player2_id];
  const [playersResult, entriesResult, linkedUsersResult] = await Promise.all([
    client.from("players").select("id,display_name,full_name").in("id", participantIds),
    client.from("competition_entries").select("id,player_id,public_signup_id,fixture_access_token").eq("competition_id", match.competition_id).eq("status", "approved").in("player_id", participantIds),
    client.from("app_users").select("id,linked_player_id,email").in("linked_player_id", participantIds),
  ]);
  if (playersResult.error || entriesResult.error || linkedUsersResult.error) {
    return { sent: 0, failed: 0, error: playersResult.error?.message ?? entriesResult.error?.message ?? linkedUsersResult.error?.message };
  }
  const entries = entriesResult.data ?? [];
  const signupIds = entries.map((entry) => entry.public_signup_id).filter(Boolean) as string[];
  const [signupResult, savedContactResult] = await Promise.all([
    signupIds.length
      ? client.from("public_competition_signups").select("id,email,fixture_access_token").in("id", signupIds)
      : Promise.resolve({ data: [], error: null }),
    entries.length
      ? client.from("competition_entry_contacts").select("competition_entry_id,email").in("competition_entry_id", entries.map((entry) => entry.id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (signupResult.error || savedContactResult.error) {
    return { sent: 0, failed: 0, error: signupResult.error?.message ?? savedContactResult.error?.message };
  }

  const playerById = new Map((playersResult.data ?? []).map((player) => [player.id, player]));
  const entryByPlayer = new Map(entries.map((entry) => [entry.player_id, entry]));
  const linkedUserByPlayer = new Map((linkedUsersResult.data ?? []).map((user) => [user.linked_player_id, user]));
  const signupById = new Map((signupResult.data ?? []).map((signup) => [signup.id, signup]));
  const savedByEntry = new Map((savedContactResult.data ?? []).map((contact) => [contact.competition_entry_id, contact]));
  const names = new Map(participantIds.map((playerId) => {
    const player = playerById.get(playerId);
    return [playerId, player?.full_name?.trim() || player?.display_name || "Player"];
  }));
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://rf-club-app.vercel.app").replace(/\/$/, "");
  const timingText = phase === "overdue"
    ? `The original fixture week, which ended ${formatDeadline(originalDeadline)}, has passed, but the fixture remains inside its permitted four-week playing window.`
    : `This is the final week for this fixture. The playing window closes ${formatDeadline(finalDeadline)}.`;
  const actionText = phase === "final"
    ? "Please arrange and play the fixture now, or ensure an agreed reschedule is correctly requested in Rack & Frame. If it remains unplayed after the final deadline, the normal outcome is a walkover to the second-named player following a 24-hour review period."
    : `Please arrange the fixture and record the result in Rack & Frame. If you need to move it, submit a reschedule request in the app. The final playing deadline is ${formatDeadline(finalDeadline)}.`;

  let sent = 0;
  let failed = 0;
  for (const playerId of participantIds) {
    const playerName = names.get(playerId) || "Player";
    const opponentId = playerId === match.player1_id ? match.player2_id : match.player1_id;
    const opponentName = names.get(opponentId) || "your opponent";
    const entry = entryByPlayer.get(playerId);
    const signup = signupById.get(entry?.public_signup_id ?? "");
    const linkedUser = linkedUserByPlayer.get(playerId);
    const saved = savedByEntry.get(entry?.id ?? "");
    const email = saved?.email?.trim() || signup?.email?.trim() || linkedUser?.email?.trim() || null;
    if (!email) continue;
    const token = entry?.fixture_access_token || signup?.fixture_access_token || null;
    const fixtureUrl = token ? `${siteUrl}/entrant/${token}` : `${siteUrl}/matches/${match.id}`;
    const subjectPrefix = phase === "final" ? "Final fixture reminder" : "Outstanding fixture reminder";
    const subject = `${subjectPrefix}: ${playerName} vs ${opponentName}`;
    const text = `Hi ${playerName.split(/\s+/)[0]},\n\nThis is an automatic reminder about your ${competitionName} fixture against ${opponentName}.\n\n${timingText}\n\n${actionText}\n\nView your fixture: ${fixtureUrl}\n\nRack & Frame Club`;
    const html = brandedEmail({
      eyebrow: subjectPrefix,
      title: `${playerName} vs ${opponentName}`,
      intro: `Hi ${playerName.split(/\s+/)[0]}, this is an automatic reminder about your ${competitionName} fixture.`,
      bodyHtml: `<p style="margin:0 0 14px"><strong>${escapeEmailHtml(timingText)}</strong></p><p style="margin:0">${escapeEmailHtml(actionText)}</p>`,
      primaryButton: { label: "View fixture", url: fixtureUrl },
      footerNote: "This is an automated fixture reminder from Rack & Frame Club. Replies are not monitored.",
    });
    try {
      await sendEmail({ to: email, subject, text, html, replyTo: null });
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  const linkedUserIds = (linkedUsersResult.data ?? []).map((user) => user.id);
  if (linkedUserIds.length) {
    await sendPushToUserIds(client, linkedUserIds, {
      title: phase === "final" ? "Final fixture reminder" : "Fixture reminder",
      body: `${names.get(match.player1_id)} vs ${names.get(match.player2_id)} · ${competitionName}`,
      url: `/matches/${match.id}`,
      tag: `${phaseAction(phase)}-${match.id}`,
    });
  }
  return { sent, failed, error: null };
}

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey || !hasMailerConfig()) return NextResponse.json({ error: "Server email is not configured." }, { status: 500 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const authorized = cronSecret ? token === cronSecret : Boolean(request.headers.get("x-vercel-cron"));
  if (!authorized) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const competitionsResult = await client.from("competitions").select("id,name").eq("competition_format", "league").neq("league_schedule_mode", "one_day").eq("is_archived", false).eq("is_completed", false);
  if (competitionsResult.error) return NextResponse.json({ error: competitionsResult.error.message }, { status: 400 });
  const competitions = new Map((competitionsResult.data ?? []).map((competition) => [competition.id as string, String(competition.name || "Rack & Frame competition")]));
  if (!competitions.size) return NextResponse.json({ ok: true, processed: [], sent: 0, failed: 0 });
  const matchesResult = await client.from("matches").select("id,competition_id,player1_id,player2_id,scheduled_for").in("competition_id", [...competitions.keys()]).eq("is_archived", false).in("status", ["pending", "in_progress"]);
  if (matchesResult.error) return NextResponse.json({ error: matchesResult.error.message }, { status: 400 });
  const matches = (matchesResult.data ?? []).filter((match) => match.player1_id && match.player2_id && match.player1_id !== match.player2_id && match.scheduled_for) as MatchRow[];
  if (!matches.length) return NextResponse.json({ ok: true, processed: [], sent: 0, failed: 0 });
  const matchIds = matches.map((match) => match.id);
  const [submissionResult, rescheduleResult, auditResult] = await Promise.all([
    client.from("result_submissions").select("match_id").in("match_id", matchIds).in("status", ["pending", "approved"]),
    client.from("league_reschedule_requests").select("match_id").in("match_id", matchIds).eq("status", "pending"),
    client.from("audit_logs").select("entity_id,action").eq("entity_type", "match").in("entity_id", matchIds).in("action", [phaseAction("overdue"), phaseAction("final")]),
  ]);
  if (submissionResult.error || rescheduleResult.error || auditResult.error) return NextResponse.json({ error: submissionResult.error?.message ?? rescheduleResult.error?.message ?? auditResult.error?.message }, { status: 400 });
  const protectedMatches = new Set([...(submissionResult.data ?? []).map((row) => row.match_id), ...(rescheduleResult.data ?? []).map((row) => row.match_id)]);
  const sentActions = new Set((auditResult.data ?? []).map((row) => `${row.entity_id}:${row.action}`));
  const processed: Array<{ matchId: string; phase: ReminderPhase }> = [];
  let sent = 0;
  let failed = 0;
  const now = new Date();

  for (const match of matches) {
    if (protectedMatches.has(match.id)) continue;
    const competitionName = competitions.get(match.competition_id);
    if (!competitionName) continue;
    const phase = choosePhase(now, match, competitionName);
    if (!phase || sentActions.has(`${match.id}:${phaseAction(phase)}`)) continue;
    const originalDeadline = getLeagueFixtureDeadline(match.scheduled_for, competitionName);
    const finalDeadline = getLeagueFixtureFinalDeadline(match.scheduled_for, competitionName);
    if (!originalDeadline || !finalDeadline) continue;
    const result = await sendFixtureReminder(client, match, competitionName, phase, originalDeadline, finalDeadline);
    sent += result.sent;
    failed += result.failed;
    if (result.sent > 0) {
      await client.from("audit_logs").insert({
        actor_user_id: null,
        actor_email: null,
        actor_role: "system",
        action: phaseAction(phase),
        entity_type: "match",
        entity_id: match.id,
        summary: `Automatic ${phase} fixture reminder sent to ${result.sent} player${result.sent === 1 ? "" : "s"}.`,
        meta: { competition_id: match.competition_id, phase, sent: result.sent, failed: result.failed, final_deadline: finalDeadline.toISOString() },
      });
      processed.push({ matchId: match.id, phase });
    }
  }
  return NextResponse.json({ ok: true, processed, sent, failed });
}
