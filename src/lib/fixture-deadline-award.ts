import type { SupabaseClient } from "@supabase/supabase-js";
import { getWelcomeCandidate } from "@/lib/competition-welcome";
import { brandedEmail, escapeEmailHtml } from "@/lib/email-template";
import { hasMailerConfig, sendEmail } from "@/lib/mailer";
import { sendPushToUserIds } from "@/lib/push-server";

type AwardActor = { user: { id: string | null; email?: string | null }; role: string };

const systemFromAddress = () => process.env.SYSTEM_EMAIL_FROM_ADDRESS?.trim() || "information@rackandframe.app";

export async function awardDeadlineWalkover(client: SupabaseClient, matchId: string, actor: AwardActor) {
  const matchResult = await client.from("matches")
    .select("id,competition_id,scheduled_for,status,player1_id,player2_id,best_of,owner_user_id")
    .eq("id", matchId).maybeSingle();
  if (matchResult.error) throw new Error(matchResult.error.message);
  const match = matchResult.data;
  if (!match || !["pending", "in_progress"].includes(match.status) || !match.player1_id || !match.player2_id || match.player1_id === match.player2_id) {
    throw new Error("This fixture is no longer available for a deadline decision.");
  }

  const competitionResult = await client.from("competitions").select("id,name,sport_type").eq("id", match.competition_id).maybeSingle();
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

  let ownerUserId = match.owner_user_id as string | null;
  if (!ownerUserId) {
    const linked = await client.from("app_users").select("id").in("linked_player_id", playerIds).limit(1).maybeSingle();
    ownerUserId = linked.data?.id ?? null;
  }
  if (!ownerUserId) {
    const manager = await client.from("app_users").select("id").in("role", ["owner", "admin"]).order("created_at", { ascending: true }).limit(1).maybeSingle();
    ownerUserId = manager.data?.id ?? null;
  }
  if (!ownerUserId) throw new Error("No valid account is available to record the walkover frames.");

  const awardedCount = competition.sport_type === "snooker" ? 1 : Math.max(1, Number(match.best_of ?? 1));
  const clearFrames = await client.from("frames").delete().eq("match_id", match.id);
  if (clearFrames.error) throw new Error(clearFrames.error.message);
  const frameInsert = await client.from("frames").insert(Array.from({ length: awardedCount }, (_, index) => ({
    match_id: match.id,
    frame_number: index + 1,
    owner_user_id: ownerUserId,
    winner_player_id: match.player2_id,
    break_and_run: false,
    run_out_against_break: false,
    is_walkover_award: true,
    team1_points: 0,
    team2_points: 0,
    breaks_over_30_team1_values: [],
    breaks_over_30_team2_values: [],
    breaks_over_30_team1: 0,
    breaks_over_30_team2: 0,
    high_break_team1: 0,
    high_break_team2: 0,
  })));
  if (frameInsert.error) throw new Error(frameInsert.error.message);
  const matchUpdate = await client.from("matches").update({ status: "complete", winner_player_id: match.player2_id }).eq("id", match.id).in("status", ["pending", "in_progress"]).select("id").maybeSingle();
  if (matchUpdate.error || !matchUpdate.data) throw new Error(matchUpdate.error?.message || "The fixture changed before the decision could be saved.");

  await client.from("audit_logs").insert({
    actor_user_id: actor.user.id,
    actor_email: actor.user.email ?? null,
    actor_role: actor.role,
    action: "fixture_deadline_walkover_awarded",
    entity_type: "match",
    entity_id: match.id,
    summary: `The overdue fixture was awarded to ${playerTwoName} after the review period closed.`,
    meta: { competition_id: match.competition_id, winner_player_id: match.player2_id, decision_source: actor.role === "system" ? "automatic" : "manager_queue" },
  });

  const participantUsers = await client.from("app_users").select("id").in("linked_player_id", playerIds);
  if (!participantUsers.error) await sendPushToUserIds(client, (participantUsers.data ?? []).map((row) => row.id), {
    title: "Fixture outcome confirmed",
    body: `${competition.name}: ${playerTwoName} has been awarded the overdue fixture against ${playerOneName}.`,
    url: `/matches/${match.id}`,
    tag: `fixture-awarded-${match.id}`,
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
    const isWinner = playerId === match.player2_id;
    const recipientName = names.get(playerId) || "Player";
    const firstName = recipientName.split(/\s+/)[0] || "Player";
    const outcome = `${playerTwoName} has been awarded the overdue fixture against ${playerOneName} after the playing deadline and review period closed.`;
    const subject = `Fixture outcome confirmed: ${playerOneName} vs ${playerTwoName}`;
    const text = `Hi ${firstName},\n\n${outcome}\n\nCompetition: ${competition.name}\nOutcome: ${playerTwoName} awarded the win.\n\nView your fixtures: ${siteUrl}/my-fixtures\n\nThis is an automated message; replies are not monitored.\n\nRack & Frame Club`;
    const html = brandedEmail({
      eyebrow: "Overdue fixture decision",
      title: isWinner ? "The fixture has been awarded to you" : "Fixture outcome confirmed",
      intro: `Hi ${firstName}, ${outcome}`,
      bodyHtml: `<div style="padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0"><div style="font-size:14px;color:#64748b">Competition</div><div style="margin-top:4px;font-weight:800;color:#0f172a">${escapeEmailHtml(competition.name)}</div><div style="margin-top:14px;font-size:14px;color:#64748b">Confirmed outcome</div><div style="margin-top:4px;font-weight:800;color:#0f172a">${escapeEmailHtml(playerTwoName)} awarded the win</div></div>`,
      primaryButton: { label: "View my fixtures", url: `${siteUrl}/my-fixtures` },
      footerNote: "This outcome notification is sent automatically from Rack & Frame Information. Replies are not monitored.",
    });
    try {
      const sent = await sendEmail({ to: email, subject, text, html, fromAddress: systemFromAddress(), fromName: "Rack & Frame Information", replyTo: null });
      await client.from("audit_logs").insert({ actor_user_id: actor.user.id, actor_email: actor.user.email ?? null, actor_role: actor.role, action: "fixture_deadline_outcome_email_sent", entity_type: "match", entity_id: match.id, summary: `Deadline outcome email sent to ${recipientName}.`, meta: { recipient: email, player_id: playerId, winner: isWinner, message_id: sent.messageId, provider: sent.provider } });
      emailResults.push({ playerId, status: "sent" });
    } catch (error) {
      await client.from("audit_logs").insert({ actor_user_id: actor.user.id, actor_email: actor.user.email ?? null, actor_role: actor.role, action: "fixture_deadline_outcome_email_failed", entity_type: "match", entity_id: match.id, summary: `Deadline outcome email to ${recipientName} failed.`, meta: { recipient: email, player_id: playerId, error: error instanceof Error ? error.message : "Email failed." } });
      emailResults.push({ playerId, status: "failed" });
    }
  }

  return { matchId: match.id, winnerPlayerId: match.player2_id, winnerName: playerTwoName, emailResults };
}
