import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { brandedEmail, escapeEmailHtml } from "@/lib/email-template";
import { getLeagueFixtureDeadline } from "@/lib/league-deadline";
import { hasMailerConfig, sendEmail } from "@/lib/mailer";
import { sendPushToUserIds } from "@/lib/push-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();

async function authorize(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return null;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return null;
  const appUserResult = await client.from("app_users").select("role,linked_player_id").eq("id", user.id).maybeSingle();
  return {
    client,
    user,
    role: String(appUserResult.data?.role ?? "").toLowerCase(),
    linkedPlayerId: appUserResult.data?.linked_player_id as string | null,
  };
}

async function canManageCompetition(client: SupabaseClient, competitionId: string, auth: NonNullable<Awaited<ReturnType<typeof authorize>>>) {
  if (Boolean(superAdminEmail && auth.user.email?.toLowerCase() === superAdminEmail) || ["owner", "super"].includes(auth.role)) return true;
  if (auth.role !== "admin" || !auth.linkedPlayerId) return false;
  const [competitionResult, playerResult] = await Promise.all([
    client.from("competitions").select("location_id").eq("id", competitionId).maybeSingle(),
    client.from("players").select("location_id").eq("id", auth.linkedPlayerId).maybeSingle(),
  ]);
  return Boolean(competitionResult.data?.location_id && competitionResult.data.location_id === playerResult.data?.location_id);
}

function formatDeadline(value: Date) {
  return value.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!hasMailerConfig()) return NextResponse.json({ error: "Resend is not configured." }, { status: 503 });
  const body = await request.json().catch(() => null);
  const matchId = String(body?.matchId ?? "").trim();
  if (!matchId) return NextResponse.json({ error: "Fixture is required." }, { status: 400 });

  const matchResult = await auth.client
    .from("matches")
    .select("id,competition_id,player1_id,player2_id,scheduled_for,status,is_archived")
    .eq("id", matchId)
    .maybeSingle();
  const match = matchResult.data;
  if (matchResult.error || !match || match.is_archived || !match.player1_id || !match.player2_id) {
    return NextResponse.json({ error: matchResult.error?.message || "Fixture not found." }, { status: 404 });
  }
  if (!(await canManageCompetition(auth.client, match.competition_id, auth))) {
    return NextResponse.json({ error: "Club Manager access required." }, { status: 403 });
  }
  if (!["pending", "in_progress"].includes(match.status)) {
    return NextResponse.json({ error: "This fixture no longer needs a reminder." }, { status: 409 });
  }

  const participantIds = [match.player1_id, match.player2_id];
  const [competitionResult, playersResult, entriesResult, linkedUsersResult, rescheduleResult] = await Promise.all([
    auth.client.from("competitions").select("id,name").eq("id", match.competition_id).maybeSingle(),
    auth.client.from("players").select("id,display_name,full_name").in("id", participantIds),
    auth.client.from("competition_entries").select("id,player_id,public_signup_id,fixture_access_token").eq("competition_id", match.competition_id).eq("status", "approved").in("player_id", participantIds),
    auth.client.from("app_users").select("id,linked_player_id,email").in("linked_player_id", participantIds),
    auth.client.from("league_reschedule_requests").select("original_scheduled_for,requested_scheduled_for,status,created_at").eq("match_id", matchId).eq("status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const firstError = competitionResult.error || playersResult.error || entriesResult.error || linkedUsersResult.error || rescheduleResult.error;
  if (firstError || !competitionResult.data) {
    return NextResponse.json({ error: firstError?.message || "Fixture details could not be loaded." }, { status: 400 });
  }

  const entries = entriesResult.data ?? [];
  const signupIds = entries.map((entry) => entry.public_signup_id).filter(Boolean) as string[];
  const [signupResult, savedContactResult] = await Promise.all([
    signupIds.length
      ? auth.client.from("public_competition_signups").select("id,email,fixture_access_token").in("id", signupIds)
      : Promise.resolve({ data: [], error: null }),
    entries.length
      ? auth.client.from("competition_entry_contacts").select("competition_entry_id,email").in("competition_entry_id", entries.map((entry) => entry.id))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (signupResult.error || savedContactResult.error) {
    return NextResponse.json({ error: signupResult.error?.message || savedContactResult.error?.message }, { status: 400 });
  }

  const competitionName = competitionResult.data.name || "Rack & Frame competition";
  const playerById = new Map((playersResult.data ?? []).map((player) => [player.id, player]));
  const entryByPlayer = new Map(entries.map((entry) => [entry.player_id, entry]));
  const linkedUserByPlayer = new Map((linkedUsersResult.data ?? []).map((user) => [user.linked_player_id, user]));
  const signupById = new Map((signupResult.data ?? []).map((signup) => [signup.id, signup]));
  const savedByEntry = new Map((savedContactResult.data ?? []).map((contact) => [contact.competition_entry_id, contact]));
  const names = new Map(participantIds.map((playerId) => {
    const player = playerById.get(playerId);
    return [playerId, player?.full_name?.trim() || player?.display_name || "Player"];
  }));
  const deadline = getLeagueFixtureDeadline(match.scheduled_for, competitionName);
  if (!deadline) return NextResponse.json({ error: "This fixture does not have a playing deadline." }, { status: 400 });
  const overdue = deadline.getTime() < Date.now();
  const rescheduled = Boolean(rescheduleResult.data);
  const statusText = rescheduled
    ? overdue ? "This rescheduled fixture has now passed its revised deadline." : "This fixture has been rescheduled and is still waiting to be played."
    : overdue ? "This fixture has passed its original deadline and no reschedule has been agreed." : "This fixture is still waiting to be played.";
  const actionText = overdue
    ? rescheduled
      ? "Please arrange and play the fixture promptly. If another exceptional change is needed, contact the competition organiser and make sure the new arrangement is recorded correctly in Rack & Frame. A fixture that remains overdue by more than one week without a completed result or an approved revised arrangement may be voided."
      : "Please arrange and play the fixture promptly, or agree a permitted new game week and submit a reschedule request in Rack & Frame for the organiser to approve. A fixture that remains overdue by more than one week without a completed result or an approved reschedule may be voided."
    : `Please arrange and complete the fixture by ${formatDeadline(deadline)}. If you agree a permitted different week, submit the reschedule request in Rack & Frame so the organiser can approve it.`;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://rf-club-app.vercel.app").replace(/\/$/, "");
  const sent: string[] = [];
  const missing: string[] = [];
  const failed: string[] = [];

  for (const playerId of participantIds) {
    const playerName = names.get(playerId) || "Player";
    const opponentId = playerId === match.player1_id ? match.player2_id : match.player1_id;
    const opponentName = names.get(opponentId) || "your opponent";
    const entry = entryByPlayer.get(playerId);
    const signup = signupById.get(entry?.public_signup_id ?? "");
    const linkedUser = linkedUserByPlayer.get(playerId);
    const saved = savedByEntry.get(entry?.id ?? "");
    const email = saved?.email?.trim() || signup?.email?.trim() || linkedUser?.email?.trim() || null;
    const token = entry?.fixture_access_token || signup?.fixture_access_token || null;
    const fixtureUrl = token ? `${siteUrl}/entrant/${token}` : `${siteUrl}/my-fixtures`;
    if (!email) {
      missing.push(playerName);
      continue;
    }
    const subject = `${overdue ? "Action needed: overdue fixture" : "Fixture reminder"}: ${playerName} vs ${opponentName}`;
    const text = `Hi ${playerName.split(/\s+/)[0]},\n\nThis is a reminder about your ${competitionName} fixture against ${opponentName}.\n\n${statusText}\n\n${actionText}\n\nView your fixture: ${fixtureUrl}\n\nRack & Frame Club`;
    const html = brandedEmail({
      eyebrow: "Outstanding fixture reminder",
      title: `${playerName} vs ${opponentName}`,
      intro: `Hi ${playerName.split(/\s+/)[0]}, this is a reminder about your ${competitionName} fixture.`,
      bodyHtml: `<p style="margin:0 0 14px"><strong>${escapeEmailHtml(statusText)}</strong></p><p style="margin:0">${escapeEmailHtml(actionText)}</p>`,
      primaryButton: { label: "View fixture", url: fixtureUrl },
      footerNote: "This is an automated fixture reminder from Rack & Frame Club. Replies are not monitored.",
    });
    try {
      const emailResult = await sendEmail({ to: email, subject, text, html, replyTo: null });
      sent.push(playerName);
      await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: "fixture_reminder_sent", entity_type: "match", entity_id: matchId, summary: `Fixture reminder sent to ${email}.`, meta: { recipient: email, subject, provider: emailResult.provider, sender: process.env.EMAIL_FROM_ADDRESS ?? null, message_id: emailResult.messageId, competition: competitionName, player: playerName } });
    } catch (error) {
      failed.push(playerName);
      await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: "fixture_reminder_failed", entity_type: "match", entity_id: matchId, summary: `Fixture reminder to ${email} failed.`, meta: { recipient: email, subject, provider: "Resend", sender: process.env.EMAIL_FROM_ADDRESS ?? null, competition: competitionName, player: playerName, error: error instanceof Error ? error.message : "Email failed." } });
    }
  }

  const linkedUserIds = (linkedUsersResult.data ?? []).map((user) => user.id);
  if (linkedUserIds.length) {
    await sendPushToUserIds(auth.client, linkedUserIds, {
      title: "Outstanding fixture reminder",
      body: `${names.get(match.player1_id)} vs ${names.get(match.player2_id)} · ${competitionName}`,
      url: `/matches/${matchId}`,
      tag: `fixture-reminder-${matchId}`,
    });
  }
  if (!sent.length) {
    const error = failed.length
      ? "The reminder emails could not be sent."
      : "Neither player has an email address recorded for this competition.";
    return NextResponse.json({ error, sent, missing, failed }, { status: failed.length ? 502 : 409 });
  }
  return NextResponse.json({ ok: true, sent, missing, failed });
}
