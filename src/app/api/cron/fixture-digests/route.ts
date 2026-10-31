import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { brandedEmail, escapeEmailHtml } from "@/lib/email-template";
import { getLeagueFixtureDeadline, getLeagueFixtureFinalDeadline, getLeagueFixtureWalkoverReviewUntil } from "@/lib/league-deadline";
import { hasMailerConfig, sendEmail } from "@/lib/mailer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;

type DigestMatch = {
  id: string;
  competition_id: string;
  player1_id: string;
  player2_id: string;
  scheduled_for: string;
  round_no: number | null;
};

type DigestItem = {
  matchId: string;
  competitionName: string;
  opponentName: string;
  weekBeginning: string;
  finalDeadline: Date;
  awardAt: Date;
  automaticAwardName: string;
  fixtureUrl: string;
  firstNamed: boolean;
};

function londonDateIso(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0)).toISOString().slice(0, 10);
}

function displayWeek(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
}

function displayDeadline(value: Date) {
  return value.toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function itemHtml(item: DigestItem, overdue: boolean) {
  return `<div style="margin:0 0 12px;padding:14px;border:1px solid ${overdue ? "#fecaca" : "#dbeafe"};border-radius:12px;background:${overdue ? "#fff7f7" : "#f8fbff"}">
    <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${overdue ? "#b91c1c" : "#0369a1"}">${escapeEmailHtml(item.competitionName)}</div>
    <div style="margin-top:5px;font-size:17px;font-weight:700;color:#0f172a">vs ${escapeEmailHtml(item.opponentName)}</div>
    <div style="margin-top:6px;font-size:14px;color:#475569">Week beginning ${escapeEmailHtml(displayWeek(item.weekBeginning))}</div>
    ${item.firstNamed ? '<div style="margin-top:6px;font-size:13px;font-weight:600;color:#92400e">You are the first-named player and are responsible for ensuring the fixture is arranged and recorded.</div>' : ""}
    <div style="margin-top:6px;font-size:13px;color:${overdue ? "#991b1b" : "#475569"}">Final playing deadline: <strong>${escapeEmailHtml(displayDeadline(item.finalDeadline))}</strong></div>
    <div style="margin-top:6px;font-size:13px;color:${overdue ? "#991b1b" : "#475569"}">If unresolved and no arranging evidence is recorded, the fixture will be awarded to <strong>${escapeEmailHtml(item.automaticAwardName)}</strong> after <strong>${escapeEmailHtml(displayDeadline(item.awardAt))}</strong>.</div>
    <div style="margin-top:9px"><a href="${escapeEmailHtml(item.fixtureUrl)}" style="font-size:13px;font-weight:700;color:#047857">Open fixture</a></div>
  </div>`;
}

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey || !hasMailerConfig()) return NextResponse.json({ error: "Server email is not configured." }, { status: 500 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const authorized = cronSecret ? token === cronSecret : Boolean(request.headers.get("x-vercel-cron"));
  if (!authorized) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const today = londonDateIso();
  const nextMonday = addDays(today, 1);
  const followingWindowEnd = addDays(nextMonday, 14);
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://rf-club-app.vercel.app").replace(/\/$/, "");

  const competitionsResult = await client.from("competitions").select("id,name").eq("competition_format", "league").neq("league_schedule_mode", "one_day").eq("is_archived", false).eq("is_completed", false);
  if (competitionsResult.error) return NextResponse.json({ error: competitionsResult.error.message }, { status: 400 });
  const competitions = new Map((competitionsResult.data ?? []).map((row) => [row.id as string, String(row.name)]));
  if (!competitions.size) return NextResponse.json({ ok: true, sent: 0, skipped: 0 });
  const matchesResult = await client.from("matches").select("id,competition_id,player1_id,player2_id,scheduled_for,round_no").in("competition_id", [...competitions.keys()]).eq("is_archived", false).in("status", ["pending", "in_progress"]);
  if (matchesResult.error) return NextResponse.json({ error: matchesResult.error.message }, { status: 400 });
  const matches = (matchesResult.data ?? []).filter((match) => match.player1_id && match.player2_id && match.player1_id !== match.player2_id && match.scheduled_for) as DigestMatch[];
  if (!matches.length) return NextResponse.json({ ok: true, sent: 0, skipped: 0 });
  const matchIds = matches.map((match) => match.id);
  const playerIds = [...new Set(matches.flatMap((match) => [match.player1_id, match.player2_id]))];
  const [playersResult, entriesResult, linkedUsersResult, submissionResult, priorDigestResult] = await Promise.all([
    client.from("players").select("id,display_name,full_name").in("id", playerIds),
    client.from("competition_entries").select("id,competition_id,player_id,public_signup_id,fixture_access_token").in("competition_id", [...competitions.keys()]).eq("status", "approved").in("player_id", playerIds),
    client.from("app_users").select("id,linked_player_id,email").in("linked_player_id", playerIds),
    client.from("result_submissions").select("match_id").in("match_id", matchIds).in("status", ["pending", "approved"]),
    client.from("audit_logs").select("entity_id").eq("entity_type", "player").eq("action", "fixture_weekly_digest_sent").gte("created_at", `${today}T00:00:00Z`),
  ]);
  if (playersResult.error || entriesResult.error || linkedUsersResult.error || submissionResult.error || priorDigestResult.error) {
    return NextResponse.json({ error: playersResult.error?.message ?? entriesResult.error?.message ?? linkedUsersResult.error?.message ?? submissionResult.error?.message ?? priorDigestResult.error?.message }, { status: 400 });
  }
  const entries = entriesResult.data ?? [];
  const signupIds = entries.map((entry) => entry.public_signup_id).filter(Boolean) as string[];
  const [signupResult, contactsResult] = await Promise.all([
    signupIds.length ? client.from("public_competition_signups").select("id,email,fixture_access_token").in("id", signupIds) : Promise.resolve({ data: [], error: null }),
    entries.length ? client.from("competition_entry_contacts").select("competition_entry_id,email").in("competition_entry_id", entries.map((entry) => entry.id)) : Promise.resolve({ data: [], error: null }),
  ]);
  if (signupResult.error || contactsResult.error) return NextResponse.json({ error: signupResult.error?.message ?? contactsResult.error?.message }, { status: 400 });

  const names = new Map((playersResult.data ?? []).map((player) => [player.id, player.full_name?.trim() || player.display_name]));
  const linkedByPlayer = new Map((linkedUsersResult.data ?? []).map((user) => [user.linked_player_id, user]));
  const entryByCompetitionPlayer = new Map(entries.map((entry) => [`${entry.competition_id}:${entry.player_id}`, entry]));
  const signupById = new Map((signupResult.data ?? []).map((signup) => [signup.id, signup]));
  const contactByEntry = new Map((contactsResult.data ?? []).map((contact) => [contact.competition_entry_id, contact]));
  const protectedMatches = new Set((submissionResult.data ?? []).map((row) => row.match_id));
  const alreadySent = new Set((priorDigestResult.data ?? []).map((row) => row.entity_id));
  const now = new Date();
  let sent = 0;
  let skipped = 0;

  for (const playerId of playerIds) {
    if (alreadySent.has(playerId)) { skipped += 1; continue; }
    const playerMatches = matches.filter((match) => !protectedMatches.has(match.id) && (match.player1_id === playerId || match.player2_id === playerId));
    const upcoming: DigestItem[] = [];
    const outstanding: DigestItem[] = [];
    for (const match of playerMatches) {
      const competitionName = competitions.get(match.competition_id);
      if (!competitionName) continue;
      const originalDeadline = getLeagueFixtureDeadline(match.scheduled_for, competitionName);
      const finalDeadline = getLeagueFixtureFinalDeadline(match.scheduled_for, competitionName);
      const awardAt = getLeagueFixtureWalkoverReviewUntil(match.scheduled_for, competitionName);
      if (!originalDeadline || !finalDeadline || !awardAt) continue;
      const entry = entryByCompetitionPlayer.get(`${match.competition_id}:${playerId}`);
      const signup = signupById.get(entry?.public_signup_id ?? "");
      const tokenValue = entry?.fixture_access_token || signup?.fixture_access_token || null;
      const item: DigestItem = {
        matchId: match.id,
        competitionName,
        opponentName: names.get(match.player1_id === playerId ? match.player2_id : match.player1_id) || "Opponent",
        weekBeginning: match.scheduled_for,
        finalDeadline,
        awardAt,
        automaticAwardName: names.get(match.player2_id) || "the second-named player",
        fixtureUrl: tokenValue ? `${siteUrl}/entrant/${tokenValue}` : `${siteUrl}/matches/${match.id}`,
        firstNamed: match.player1_id === playerId,
      };
      if (match.scheduled_for >= nextMonday && match.scheduled_for < followingWindowEnd) upcoming.push(item);
      if (originalDeadline < now) outstanding.push(item);
    }
    if (!upcoming.length && !outstanding.length) { skipped += 1; continue; }
    const linkedUser = linkedByPlayer.get(playerId);
    const candidateEntries = entries.filter((entry) => entry.player_id === playerId);
    const candidateEmails = candidateEntries.flatMap((entry) => {
      const signup = signupById.get(entry.public_signup_id ?? "");
      return [contactByEntry.get(entry.id)?.email?.trim(), signup?.email?.trim()].filter(Boolean) as string[];
    });
    const email = candidateEmails[0] || linkedUser?.email?.trim() || null;
    if (!email) { skipped += 1; continue; }
    const playerName = names.get(playerId) || "Player";
    const sections = [
      upcoming.length ? `<h2 style="margin:22px 0 10px;font-size:19px;color:#0f172a">Your fixtures for the next two weeks</h2>${upcoming.sort((a, b) => a.weekBeginning.localeCompare(b.weekBeginning)).map((item) => itemHtml(item, false)).join("")}` : "",
      outstanding.length ? `<h2 style="margin:22px 0 10px;font-size:19px;color:#991b1b">Outstanding fixtures</h2><p style="margin:0 0 12px;color:#7f1d1d">These still need to be played or correctly rescheduled. Each fixture shows the final playing deadline and when the default walkover will be confirmed after the 24-hour evidence review.</p>${outstanding.sort((a, b) => a.finalDeadline.getTime() - b.finalDeadline.getTime()).map((item) => itemHtml(item, true)).join("")}` : "",
    ].join("");
    const textLines = [
      `Hi ${playerName.split(/\s+/)[0]},`,
      "",
      "Here is your Sunday Rack & Frame fixture update.",
      "",
      ...upcoming.flatMap((item) => [`NEXT TWO WEEKS: ${item.competitionName} — vs ${item.opponentName} — week beginning ${displayWeek(item.weekBeginning)} — final playing deadline ${displayDeadline(item.finalDeadline)} — if unresolved and no arranging evidence is recorded, awarded to ${item.automaticAwardName} after ${displayDeadline(item.awardAt)}`, item.fixtureUrl]),
      ...outstanding.flatMap((item) => [`OUTSTANDING: ${item.competitionName} — vs ${item.opponentName} — final playing deadline ${displayDeadline(item.finalDeadline)} — if unresolved and no arranging evidence is recorded, awarded to ${item.automaticAwardName} after ${displayDeadline(item.awardAt)}`, item.fixtureUrl]),
      "",
      "Rack & Frame Club",
    ];
    const html = brandedEmail({
      eyebrow: "Sunday fixture update",
      title: "Your fixtures and outstanding matches",
      intro: `Hi ${playerName.split(/\s+/)[0]}, here is your personal Rack & Frame fixture update for the week ahead.`,
      bodyHtml: sections,
      primaryButton: { label: "Open My Fixtures", url: `${siteUrl}/my-fixtures` },
      footerNote: "This is an automated weekly update from Rack & Frame Club. Replies are not monitored.",
    });
    try {
      const result = await sendEmail({ to: email, subject: "Your Rack & Frame fixtures for the next two weeks", text: textLines.join("\n"), html, replyTo: null });
      sent += 1;
      await client.from("audit_logs").insert({ actor_user_id: null, actor_email: null, actor_role: "system", action: "fixture_weekly_digest_sent", entity_type: "player", entity_id: playerId, summary: `Sunday fixture digest sent to ${email}.`, meta: { recipient: email, week_start: nextMonday, upcoming_count: upcoming.length, outstanding_count: outstanding.length, provider: result.provider, message_id: result.messageId } });
    } catch (error) {
      await client.from("audit_logs").insert({ actor_user_id: null, actor_email: null, actor_role: "system", action: "fixture_weekly_digest_failed", entity_type: "player", entity_id: playerId, summary: `Sunday fixture digest to ${email} failed.`, meta: { recipient: email, week_start: nextMonday, error: error instanceof Error ? error.message : "Email failed." } });
    }
  }
  return NextResponse.json({ ok: true, sent, skipped, weekStart: nextMonday, windowEnd: followingWindowEnd });
}
