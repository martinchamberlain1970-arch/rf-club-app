import type { SupabaseClient } from "@supabase/supabase-js";
import { getWelcomeCandidate } from "@/lib/competition-welcome";
import { brandedEmail, escapeEmailHtml } from "@/lib/email-template";
import { hasMailerConfig, sendEmail } from "@/lib/mailer";

type BookingActor = { user: { id: string | null; email?: string | null }; role: string };

export type CompetitionBookingEmailDetails = {
  id: string;
  competitionId: string;
  participantOnePlayerId: string;
  participantTwoPlayerId: string;
  participantOne: string;
  participantTwo: string;
  tableName: string;
  startsAt: string;
  endsAt: string;
};

function londonBookingDate(startsAt: string) {
  return new Date(startsAt).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });
}

function londonBookingTime(startsAt: string, endsAt: string) {
  const format = (value: string) => new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  return `${format(startsAt)}–${format(endsAt)}`;
}

export async function sendCompetitionBookingEmails(
  client: SupabaseClient,
  booking: CompetitionBookingEmailDetails,
  actor: BookingActor,
  kind: "confirmed" | "updated" | "existing_booking" = "confirmed"
) {
  const entryResult = await client
    .from("competition_entries")
    .select("id,player_id")
    .eq("competition_id", booking.competitionId)
    .eq("status", "approved")
    .in("player_id", [booking.participantOnePlayerId, booking.participantTwoPlayerId]);
  if (entryResult.error) throw new Error(entryResult.error.message);

  const entryByPlayer = new Map((entryResult.data ?? []).map((entry) => [entry.player_id as string, entry.id as string]));
  const candidateRows = await Promise.all([
    { playerId: booking.participantOnePlayerId, playerName: booking.participantOne },
    { playerId: booking.participantTwoPlayerId, playerName: booking.participantTwo },
  ].map(async (participant) => {
    const entryId = entryByPlayer.get(participant.playerId);
    const candidate = entryId ? await getWelcomeCandidate(client, entryId) : null;
    return { ...participant, entryId, candidate };
  }));

  const competitionName = candidateRows.find((row) => row.candidate?.competitionName)?.candidate?.competitionName ?? "Rack & Frame competition";
  const fixtureName = `${booking.participantOne} vs ${booking.participantTwo}`;
  const date = londonBookingDate(booking.startsAt);
  const time = londonBookingTime(booking.startsAt, booking.endsAt);
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://rf-club-app.vercel.app").replace(/\/$/, "");
  const bookingUrl = `${siteUrl}/table-bookings#confirmed-bookings`;
  const subject = `${kind === "updated" ? "Table booking updated" : "Table booked"}: ${fixtureName}`;
  const sentTo = new Set<string>();
  const previousResult = kind === "updated"
    ? { data: [] as Array<{ meta: Record<string, unknown> | null }> }
    : await client.from("audit_logs").select("meta").eq("action", "table_booking_player_email_sent").eq("entity_id", booking.id);
  const previouslySentTo = new Set((previousResult.data ?? [])
    .filter((row) => row.meta?.kind === kind)
    .map((row) => String(row.meta?.recipient ?? "").trim().toLowerCase())
    .filter(Boolean));
  const results: Array<{ playerId: string; playerName: string; email: string | null; status: "sent" | "no_email" | "duplicate" | "not_configured" | "failed"; messageId: string | null; error?: string }> = [];

  for (const row of candidateRows) {
    const email = row.candidate?.email?.trim().toLowerCase() || null;
    if (!email) {
      results.push({ playerId: row.playerId, playerName: row.playerName, email: null, status: "no_email", messageId: null });
      continue;
    }
    if (sentTo.has(email) || previouslySentTo.has(email)) {
      results.push({ playerId: row.playerId, playerName: row.playerName, email, status: "duplicate", messageId: null });
      continue;
    }
    sentTo.add(email);
    if (!hasMailerConfig()) {
      results.push({ playerId: row.playerId, playerName: row.playerName, email, status: "not_configured", messageId: null });
      continue;
    }

    const firstName = row.playerName.split(/\s+/)[0] || "Player";
    const intro = `Hi ${firstName}, ${kind === "updated" ? "the table booking for your fixture has been updated" : "a table has been booked for your fixture"}.`;
    const text = `${intro}\n\nCompetition: ${competitionName}\nFixture: ${fixtureName}\nTable: ${booking.tableName}\nDate: ${date}\nTime: ${time}\n\nView the booking: ${bookingUrl}\n\nThis is an automated message; replies are not monitored.\n\nRack & Frame Club`;
    const html = brandedEmail({
      eyebrow: kind === "updated" ? "Table booking updated" : "Table booking confirmed",
      title: fixtureName,
      intro,
      bodyHtml: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td style="padding:8px 0;color:#64748b">Competition</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a">${escapeEmailHtml(competitionName)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Table</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a">${escapeEmailHtml(booking.tableName)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Date</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a">${escapeEmailHtml(date)}</td></tr><tr><td style="padding:8px 0;color:#64748b">Time</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#0f172a">${escapeEmailHtml(time)}</td></tr></table>`,
      primaryButton: { label: "View table booking", url: bookingUrl },
      footerNote: "This is an automated booking notification. Replies are not monitored.",
    });

    try {
      const sent = await sendEmail({ to: email, subject, text, html, replyTo: null });
      await client.from("audit_logs").insert({
        actor_user_id: actor.user.id,
        actor_email: actor.user.email ?? null,
        actor_role: actor.role,
        action: "table_booking_player_email_sent",
        entity_type: "table_reservation",
        entity_id: booking.id,
        summary: `Table booking email sent to ${row.playerName}.`,
        meta: { recipient: email, player_id: row.playerId, player: row.playerName, competition: competitionName, fixture: fixtureName, kind, provider: sent.provider, sender: process.env.EMAIL_FROM_ADDRESS ?? null, message_id: sent.messageId },
      });
      results.push({ playerId: row.playerId, playerName: row.playerName, email, status: "sent", messageId: sent.messageId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Booking email could not be sent.";
      await client.from("audit_logs").insert({
        actor_user_id: actor.user.id,
        actor_email: actor.user.email ?? null,
        actor_role: actor.role,
        action: "table_booking_player_email_failed",
        entity_type: "table_reservation",
        entity_id: booking.id,
        summary: `Table booking email to ${row.playerName} failed.`,
        meta: { recipient: email, player_id: row.playerId, player: row.playerName, competition: competitionName, fixture: fixtureName, kind, provider: "Resend", sender: process.env.EMAIL_FROM_ADDRESS ?? null, error: errorMessage },
      });
      results.push({ playerId: row.playerId, playerName: row.playerName, email, status: "failed", messageId: null, error: errorMessage });
    }
  }

  return results;
}
