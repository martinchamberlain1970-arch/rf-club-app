import type { SupabaseClient } from "@supabase/supabase-js";
import { brandedEmail, escapeEmailHtml } from "@/lib/email-template";
import { hasMailerConfig, sendEmail } from "@/lib/mailer";
import { sendPushToUserIds } from "@/lib/push-server";

type Actor = { user: { id: string | null; email?: string | null }; role: string };

export type WelcomeCandidate = {
  entryId: string;
  competitionId: string;
  competitionName: string;
  playerName: string;
  firstName: string;
  email: string | null;
  fixtureAccessToken: string | null;
  isRegisteredUser: boolean;
  registeredUserId: string | null;
  paymentStatus: string | null;
};

export async function getWelcomeCandidate(client: SupabaseClient, entryId: string): Promise<WelcomeCandidate | null> {
  const entryResult = await client
    .from("competition_entries")
    .select("id,competition_id,requester_user_id,player_id,status,payment_status,public_signup_id,competitions(name),players(display_name,full_name)")
    .eq("id", entryId)
    .maybeSingle();
  const entry = entryResult.data;
  if (!entry || entry.status !== "approved") return null;
  const [contactResult, signupResult, linkedUserResult] = await Promise.all([
    client.from("competition_entry_contacts").select("email").eq("competition_entry_id", entry.id).maybeSingle(),
    entry.public_signup_id
      ? client.from("public_competition_signups").select("email,fixture_access_token").eq("id", entry.public_signup_id).maybeSingle()
      : Promise.resolve({ data: null }),
    client.from("app_users").select("id,email").eq("linked_player_id", entry.player_id).limit(1).maybeSingle(),
  ]);
  const requesterResult = entry.requester_user_id
    ? await client.from("app_users").select("id,email").eq("id", entry.requester_user_id).maybeSingle()
    : { data: null };
  const player = entry.players as unknown as { display_name?: string; full_name?: string | null } | null;
  const competition = entry.competitions as unknown as { name?: string } | null;
  const signup = signupResult.data as { email?: string | null; fixture_access_token?: string | null } | null;
  const linkedUser = linkedUserResult.data as { id?: string; email?: string | null } | null;
  const requester = requesterResult.data as { id?: string; email?: string | null } | null;
  const playerName = player?.full_name?.trim() || player?.display_name?.trim() || "Player";
  return {
    entryId: entry.id,
    competitionId: entry.competition_id,
    competitionName: competition?.name?.trim() || "Rack & Frame competition",
    playerName,
    firstName: playerName.split(/\s+/)[0] || "Player",
    email: contactResult.data?.email?.trim() || signup?.email?.trim() || linkedUser?.email?.trim() || requester?.email?.trim() || null,
    fixtureAccessToken: signup?.fixture_access_token ?? null,
    isRegisteredUser: Boolean(linkedUser?.id || requester?.id),
    registeredUserId: linkedUser?.id ?? requester?.id ?? null,
    paymentStatus: entry.payment_status ?? null,
  };
}

export async function sendCompetitionWelcome(client: SupabaseClient, entryId: string, actor: Actor, options?: { force?: boolean }) {
  const candidate = await getWelcomeCandidate(client, entryId);
  if (!candidate) return { status: "not_approved" as const, candidate: null, messageId: null };
  const previous = await client.from("audit_logs").select("id,meta").eq("action", "competition_welcome_sent").eq("entity_id", entryId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (previous.data && !options?.force) return { status: "already_sent" as const, candidate, messageId: (previous.data.meta as { message_id?: string } | null)?.message_id ?? null };
  if (candidate.registeredUserId) {
    await sendPushToUserIds(client, [candidate.registeredUserId], {
      title: "Competition entry approved",
      body: `Welcome to ${candidate.competitionName}. Your place is confirmed.`,
      url: `/competitions/${candidate.competitionId}`,
      tag: `competition-entry-${entryId}`,
    });
  }
  if (!candidate.email) {
    await client.from("audit_logs").insert({ actor_user_id: actor.user.id, actor_email: actor.user.email ?? null, actor_role: actor.role, action: "competition_welcome_skipped", entity_type: "competition_entry", entity_id: entryId, summary: `Welcome email skipped for ${candidate.playerName}: no email address.`, meta: { competition: candidate.competitionName, player: candidate.playerName } });
    return { status: "no_email" as const, candidate, messageId: null };
  }
  if (!hasMailerConfig()) return { status: "not_configured" as const, candidate, messageId: null };
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://rf-club-app.vercel.app").replace(/\/$/, "");
  const fixtureUrl = candidate.fixtureAccessToken ? `${siteUrl}/entrant/${candidate.fixtureAccessToken}` : `${siteUrl}/my-fixtures`;
  const competitionUrl = `${siteUrl}/competitions/${candidate.competitionId}`;
  const paymentLine = candidate.paymentStatus === "paid"
    ? "Your entry payment is recorded as paid."
    : candidate.paymentStatus === "not_required" ? "No entry payment is required." : "Your entry is confirmed; any outstanding payment remains visible to the competition organiser.";
  const subject = `Welcome to ${candidate.competitionName}`;
  const text = `Hi ${candidate.firstName},\n\nWelcome to ${candidate.competitionName}. Your place in the competition is approved. ${paymentLine}\n\nView fixtures and submit results: ${fixtureUrl}\n\nCompetition page: ${competitionUrl}\n\n${candidate.fixtureAccessToken ? "Your fixture link is private and works without app registration. Please do not share it." : "Open the Rack & Frame app to see fixtures, results and competition updates."}\n\nRack & Frame Club`;
  const html = brandedEmail({
    eyebrow: "Competition entry confirmed",
    title: `Welcome to ${candidate.competitionName}`,
    intro: `Hi ${candidate.firstName}, your place in the competition has been approved.`,
    bodyHtml: `<p style="margin:0 0 14px"><strong>${escapeEmailHtml(paymentLine)}</strong></p><p style="margin:0">Use Rack &amp; Frame to check fixtures, contact opponents where available, submit results and follow the league table.</p>`,
    primaryButton: { label: "View fixtures & submit results", url: fixtureUrl },
    secondaryButton: { label: "Open competition", url: competitionUrl },
    footerNote: candidate.fixtureAccessToken ? "This is your private result link. It works without app registration, so please keep it private." : "Sign in using the account connected to your player profile.",
  });
  try {
    const sent = await sendEmail({ to: candidate.email, subject, text, html, replyTo: null });
    await client.from("audit_logs").insert({ actor_user_id: actor.user.id, actor_email: actor.user.email ?? null, actor_role: actor.role, action: "competition_welcome_sent", entity_type: "competition_entry", entity_id: entryId, summary: `Competition welcome sent to ${candidate.email}.`, meta: { recipient: candidate.email, subject, provider: sent.provider, sender: process.env.EMAIL_FROM_ADDRESS ?? null, competition: candidate.competitionName, player: candidate.playerName, message_id: sent.messageId } });
    return { status: "sent" as const, candidate, messageId: sent.messageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Welcome email could not be sent.";
    await client.from("audit_logs").insert({ actor_user_id: actor.user.id, actor_email: actor.user.email ?? null, actor_role: actor.role, action: "competition_welcome_failed", entity_type: "competition_entry", entity_id: entryId, summary: `Competition welcome to ${candidate.email} failed.`, meta: { recipient: candidate.email, subject, provider: "Resend", sender: process.env.EMAIL_FROM_ADDRESS ?? null, competition: candidate.competitionName, player: candidate.playerName, error: errorMessage } });
    return { status: "failed" as const, candidate, messageId: null, error: errorMessage };
  }
}
