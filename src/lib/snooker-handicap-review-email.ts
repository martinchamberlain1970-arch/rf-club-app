import type { SupabaseClient } from "@supabase/supabase-js";
import { getWelcomeCandidate } from "@/lib/competition-welcome";
import { brandedEmail, escapeEmailHtml } from "@/lib/email-template";
import { hasMailerConfig, sendEmail } from "@/lib/mailer";

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function displayDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

export async function sendSnookerHandicapReviewEmails(
  client: SupabaseClient,
  options: { effectiveFrom: string; nextReviewDate: string }
) {
  if (!hasMailerConfig()) return { sent: 0, skipped: 0, failed: 0, notConfigured: true };
  const competitionsResult = await client
    .from("competitions")
    .select("id,name")
    .eq("sport_type", "snooker")
    .eq("handicap_enabled", true)
    .eq("is_archived", false)
    .eq("is_completed", false)
    .ilike("name", "%masters%");
  if (competitionsResult.error) throw new Error(competitionsResult.error.message);
  const competitions = competitionsResult.data ?? [];
  if (!competitions.length) return { sent: 0, skipped: 0, failed: 0, notConfigured: false };

  const entriesResult = await client
    .from("competition_entries")
    .select("id,competition_id,player_id")
    .in("competition_id", competitions.map((competition) => competition.id))
    .eq("status", "approved");
  if (entriesResult.error) throw new Error(entriesResult.error.message);
  const entries = entriesResult.data ?? [];
  if (!entries.length) return { sent: 0, skipped: 0, failed: 0, notConfigured: false };

  const [playersResult, priorResult] = await Promise.all([
    client.from("players").select("id,rating_snooker,snooker_handicap").in("id", entries.map((entry) => entry.player_id)),
    client.from("audit_logs").select("entity_id,meta").eq("action", "snooker_handicap_review_email_sent").in("entity_id", entries.map((entry) => entry.id)),
  ]);
  if (playersResult.error || priorResult.error) throw new Error(playersResult.error?.message ?? priorResult.error?.message);
  const playerById = new Map((playersResult.data ?? []).map((player) => [player.id, player]));
  const competitionById = new Map(competitions.map((competition) => [competition.id, competition.name]));
  const alreadySent = new Set((priorResult.data ?? [])
    .filter((row) => (row.meta as { effectiveFrom?: string } | null)?.effectiveFrom === options.effectiveFrom)
    .map((row) => row.entity_id));
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://rf-club-app.vercel.app").trim().replace(/\/$/, "");
  const handicapsUrl = `${siteUrl}/handicaps`;
  const signedInHandicapsUrl = `${siteUrl}/auth/sign-in?next=${encodeURIComponent("/handicaps")}`;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of entries) {
    if (alreadySent.has(entry.id)) { skipped += 1; continue; }
    const [candidate, player] = [await getWelcomeCandidate(client, entry.id), playerById.get(entry.player_id)];
    if (!candidate?.email || !player) { skipped += 1; continue; }
    const handicap = Number(player.snooker_handicap ?? 0);
    const elo = Math.round(Number(player.rating_snooker ?? 1000));
    const competitionName = competitionById.get(entry.competition_id) || candidate.competitionName;
    const reviewDate = displayDate(options.effectiveFrom);
    const nextReview = displayDate(options.nextReviewDate);
    const subject = `Your Masters Snooker handicap review: ${signed(handicap)}`;
    const text = `Hi ${candidate.firstName},\n\nThe scheduled handicap review for ${competitionName} has now been completed.\n\nYour active playing handicap: ${signed(handicap)}\nCurrent Elo: ${elo}\nEffective from: ${reviewDate}\nNext scheduled review: ${nextReview}\n\nYour match start is calculated from the difference between your handicap and your opponent's handicap, and the exact start is shown on each fixture. Completed results are not changed by a handicap review.\n\nSign in and view handicaps: ${signedInHandicapsUrl}\n\nIf the button or sign-in link does not open, copy and paste this address into your browser:\n${handicapsUrl}\n\nThis is an automated message; replies are not monitored.\n\nRack & Frame Club`;
    const html = brandedEmail({
      eyebrow: "Masters Snooker handicap review",
      title: `Your new playing handicap is ${signed(handicap)}`,
      intro: `Hi ${candidate.firstName}, the scheduled handicap review for ${competitionName} has now been completed.`,
      bodyHtml: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td style="padding:9px 0;color:#64748b">Active playing handicap</td><td style="padding:9px 0;text-align:right;font-size:22px;font-weight:800;color:#0f172a">${escapeEmailHtml(signed(handicap))}</td></tr><tr><td style="padding:9px 0;color:#64748b">Current Elo</td><td style="padding:9px 0;text-align:right;font-weight:700;color:#0f172a">${elo}</td></tr><tr><td style="padding:9px 0;color:#64748b">Effective from</td><td style="padding:9px 0;text-align:right;font-weight:700;color:#0f172a">${escapeEmailHtml(reviewDate)}</td></tr><tr><td style="padding:9px 0;color:#64748b">Next scheduled review</td><td style="padding:9px 0;text-align:right;font-weight:700;color:#0f172a">${escapeEmailHtml(nextReview)}</td></tr></table><p style="margin:18px 0 0;color:#475569">Your match start is calculated from the difference between your handicap and your opponent's handicap. The exact start is shown on each fixture. Completed results are not changed.</p><p style="margin:18px 0 0;color:#64748b;font-size:13px;line-height:1.6">If the button does not open, copy and paste this address into your browser:<br><a href="${escapeEmailHtml(handicapsUrl)}" style="color:#0f766e;word-break:break-all">${escapeEmailHtml(handicapsUrl)}</a></p>`,
      primaryButton: { label: "Sign in and view all handicaps", url: signedInHandicapsUrl },
      footerNote: "This is an automated competition update from Rack & Frame Club. Replies are not monitored.",
    });
    try {
      const result = await sendEmail({ to: candidate.email, subject, text, html, replyTo: null });
      await client.from("audit_logs").insert({
        actor_user_id: null,
        actor_email: null,
        actor_role: "system",
        action: "snooker_handicap_review_email_sent",
        entity_type: "competition_entry",
        entity_id: entry.id,
        summary: `Handicap review email sent to ${candidate.playerName}.`,
        meta: { recipient: candidate.email, player_id: entry.player_id, player: candidate.playerName, competition: competitionName, handicap, elo, effectiveFrom: options.effectiveFrom, nextReviewDate: options.nextReviewDate, provider: result.provider, message_id: result.messageId },
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      await client.from("audit_logs").insert({
        actor_user_id: null,
        actor_email: null,
        actor_role: "system",
        action: "snooker_handicap_review_email_failed",
        entity_type: "competition_entry",
        entity_id: entry.id,
        summary: `Handicap review email to ${candidate.playerName} failed.`,
        meta: { recipient: candidate.email, player_id: entry.player_id, player: candidate.playerName, competition: competitionName, handicap, elo, effectiveFrom: options.effectiveFrom, nextReviewDate: options.nextReviewDate, error: error instanceof Error ? error.message : "Email failed." },
      });
    }
  }

  return { sent, skipped, failed, notConfigured: false };
}
