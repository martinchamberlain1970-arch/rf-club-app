import type { SupabaseClient } from "@supabase/supabase-js";
import { getWelcomeCandidate } from "@/lib/competition-welcome";
import { brandedEmail, escapeEmailHtml } from "@/lib/email-template";
import { hasMailerConfig, sendEmail } from "@/lib/mailer";
import { sendPushToUserIds } from "@/lib/push-server";

type DeadlineActor = { user: { id: string | null; email?: string | null }; role: string };

const systemFromAddress = () => process.env.SYSTEM_EMAIL_FROM_ADDRESS?.trim() || "information@rackandframe.app";

/** Close an unresolved weekly fixture with no winner and no points. */
export async function voidDeadlineFixture(client: SupabaseClient, matchId: string, actor: DeadlineActor) {
  const matchResult = await client.from("matches")
    .select("id,competition_id,scheduled_for,status,player1_id,player2_id")
    .eq("id", matchId).maybeSingle();
  if (matchResult.error) throw new Error(matchResult.error.message);
  const match = matchResult.data;
  if (!match || !["pending", "in_progress"].includes(match.status) || !match.player1_id || !match.player2_id || match.player1_id === match.player2_id) {
    throw new Error("This fixture is no longer available for a deadline decision.");
  }

  const competitionResult = await client.from("competitions").select("id,name").eq("id", match.competition_id).maybeSingle();
  if (competitionResult.error || !competitionResult.data) throw new Error(competitionResult.error?.message || "Competition not found.");
  const competition = competitionResult.data;
  const playerIds = [match.player1_id, match.player2_id];
  const [playersResult, entriesResult] = await Promise.all([
    client.from("players").select("id,display_name,full_name").in("id", playerIds),
    client.from("competition_entries").select("id,player_id").eq("competition_id", match.competition_id).eq("status", "approved").in("player_id", playerIds),
  ]);
  if (playersResult.error || entriesResult.error) throw new Error(playersResult.error?.message || entriesResult.error?.message || "Player details could not be loaded.");
  const names = new Map((playersResult.data ?? []).map((player) => [player.id, player.full_name?.trim() || player.display_name]));
  const playerOneName = names.get(match.player1_id) || "First-named player";
  const playerTwoName = names.get(match.player2_id) || "Second-named player";

  const clearFrames = await client.from("frames").delete().eq("match_id", match.id);
  if (clearFrames.error) throw new Error(clearFrames.error.message);
  const rejectSubmissions = await client.from("result_submissions").update({
    status: "rejected",
    reviewed_by_user_id: actor.user.id,
    reviewed_at: new Date().toISOString(),
    note: "Fixture voided after the four-week playing window closed without a result or valid reschedule.",
  }).eq("match_id", match.id).neq("status", "rejected");
  if (rejectSubmissions.error) throw new Error(rejectSubmissions.error.message);
  const matchUpdate = await client.from("matches").update({ status: "complete", winner_player_id: null }).eq("id", match.id).in("status", ["pending", "in_progress"]).select("id").maybeSingle();
  if (matchUpdate.error || !matchUpdate.data) throw new Error(matchUpdate.error?.message || "The fixture changed before the decision could be saved.");

  await client.from("audit_logs").insert({
    actor_user_id: actor.user.id,
    actor_email: actor.user.email ?? null,
    actor_role: actor.role,
    action: "fixture_deadline_voided",
    entity_type: "match",
    entity_id: match.id,
    summary: "The unresolved fixture was voided after the four-week playing window closed. Neither player received points.",
    meta: { competition_id: match.competition_id, decision_source: actor.role === "system" ? "automatic" : "manager_queue" },
  });

  const participantUsers = await client.from("app_users").select("id").in("linked_player_id", playerIds);
  if (!participantUsers.error) await sendPushToUserIds(client, (participantUsers.data ?? []).map((row) => row.id), {
    title: "Fixture voided",
    body: `${competition.name}: ${playerOneName} vs ${playerTwoName} was not completed or validly rescheduled within the playing window. No points were awarded.`,
    url: `/matches/${match.id}`,
    tag: `fixture-voided-${match.id}`,
  });

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://rf-club-app.vercel.app").replace(/\/$/, "");
  const entryByPlayer = new Map((entriesResult.data ?? []).map((entry) => [entry.player_id as string, entry.id as string]));
  const previous = await client.from("audit_logs").select("meta").eq("action", "fixture_deadline_outcome_email_sent").eq("entity_id", match.id);
  const alreadySent = new Set((previous.data ?? []).map((row) => String((row.meta as { player_id?: string } | null)?.player_id ?? "")).filter(Boolean));
  const emailResults: Array<{ playerId: string; status: string }> = [];
  for (const playerId of playerIds) {
    if (alreadySent.has(playerId)) { emailResults.push({ playerId, status: "duplicate" }); continue; }
    const entryId = entryByPlayer.get(playerId);
    const candidate = entryId ? await getWelcomeCandidate(client, entryId) : null;
    const email = candidate?.email?.trim().toLowerCase() || null;
    if (!email) { emailResults.push({ playerId, status: "no_email" }); continue; }
    if (!hasMailerConfig()) { emailResults.push({ playerId, status: "not_configured" }); continue; }
    const recipientName = names.get(playerId) || "Player";
    const firstName = recipientName.split(/\s+/)[0] || "Player";
    const outcome = `${playerOneName} vs ${playerTwoName} has been voided because no result or valid reschedule was recorded within the permitted playing window. Neither player receives points.`;
    const subject = `Fixture voided: ${playerOneName} vs ${playerTwoName}`;
    const text = `Hi ${firstName},\n\n${outcome}\n\nCompetition: ${competition.name}\nOutcome: void — no points awarded.\n\nView your fixtures: ${siteUrl}/my-fixtures\n\nThis is an automated message; replies are not monitored.\n\nRack & Frame Club`;
    const html = brandedEmail({
      eyebrow: "Fixture deadline outcome",
      title: "The fixture has been voided",
      intro: `Hi ${firstName}, ${outcome}`,
      bodyHtml: `<div style="padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0"><div style="font-size:14px;color:#64748b">Competition</div><div style="margin-top:4px;font-weight:800;color:#0f172a">${escapeEmailHtml(competition.name)}</div><div style="margin-top:14px;font-size:14px;color:#64748b">Confirmed outcome</div><div style="margin-top:4px;font-weight:800;color:#0f172a">Void — no points awarded to either player</div></div>`,
      primaryButton: { label: "View my fixtures", url: `${siteUrl}/my-fixtures` },
      footerNote: "This outcome notification is sent automatically from Rack & Frame Information. Replies are not monitored.",
    });
    try {
      const sent = await sendEmail({ to: email, subject, text, html, fromAddress: systemFromAddress(), fromName: "Rack & Frame Information", replyTo: null });
      await client.from("audit_logs").insert({ actor_user_id: actor.user.id, actor_email: actor.user.email ?? null, actor_role: actor.role, action: "fixture_deadline_outcome_email_sent", entity_type: "match", entity_id: match.id, summary: `Deadline outcome email sent to ${recipientName}.`, meta: { recipient: email, player_id: playerId, outcome: "void", message_id: sent.messageId, provider: sent.provider } });
      emailResults.push({ playerId, status: "sent" });
    } catch (error) {
      await client.from("audit_logs").insert({ actor_user_id: actor.user.id, actor_email: actor.user.email ?? null, actor_role: actor.role, action: "fixture_deadline_outcome_email_failed", entity_type: "match", entity_id: match.id, summary: `Deadline outcome email to ${recipientName} failed.`, meta: { recipient: email, player_id: playerId, error: error instanceof Error ? error.message : "Email failed." } });
      emailResults.push({ playerId, status: "failed" });
    }
  }

  return { matchId: match.id, outcome: "void" as const, emailResults };
}
