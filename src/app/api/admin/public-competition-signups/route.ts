import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasMailerConfig, sendEmail } from "@/lib/mailer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (
  process.env.SUPER_ADMIN_EMAIL ??
  process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ??
  process.env.NEXT_PUBLIC_OWNER_EMAIL ??
  ""
).trim().toLowerCase();

async function authorizedClient(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return null;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return null;
  const appUserResult = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const role = String(appUserResult.data?.role ?? "").toLowerCase();
  const isOwner = Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail);
  return isOwner || ["admin", "owner", "super"].includes(role) ? { client, user, role: isOwner ? "owner" : role } : null;
}

const normalizedName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const auth = await authorizedClient(request);
  if (!auth) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { client } = auth;

  const result = await client
    .from("public_competition_signups")
    .select("id,competition_id,full_name,email,phone,note,status,payment_status,payment_method,payment_amount_pence,paid_at,created_at,competitions(name)")
    .order("created_at", { ascending: false });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  const playersResult = await client.from("players").select("id,display_name,full_name,claimed_by").eq("is_archived", false);
  const players = playersResult.data ?? [];
  const entries = (result.data ?? []).map((entry) => {
    const guestName = normalizedName(entry.full_name);
    const guestTokens = new Set(guestName.split(" ").filter(Boolean));
    const suggestions = players
      .map((player) => {
        const candidateName = normalizedName(player.full_name?.trim() || player.display_name);
        const candidateTokens = candidateName.split(" ").filter(Boolean);
        const overlap = candidateTokens.filter((token) => guestTokens.has(token)).length;
        const score = candidateName === guestName ? 100 : overlap * 25 - Math.abs(candidateTokens.length - guestTokens.size) * 5;
        return { ...player, score };
      })
      .filter((player) => player.score >= 25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return { ...entry, suggestions };
  });
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest) {
  const auth = await authorizedClient(request);
  if (!auth) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { client, user, role } = auth;
  const body = await request.json().catch(() => null);
  const signupId = String(body?.signupId ?? "");
  const selectedPlayerId = body?.playerId ? String(body.playerId) : null;
  const createProfile = body?.createProfile === true;
  const ageBand = body?.ageBand === "under_18" ? "under_18" : "18_plus";
  if (!signupId || (!selectedPlayerId && !createProfile)) return NextResponse.json({ error: "Choose or create a player profile." }, { status: 400 });

  const signupResult = await client
    .from("public_competition_signups")
    .select("id,competition_id,full_name,email,status,payment_status,payment_method,payment_amount_pence,paid_at,fixture_access_token,competitions(name,location_id)")
    .eq("id", signupId)
    .maybeSingle();
  const signup = signupResult.data;
  if (!signup) return NextResponse.json({ error: "Public signup not found." }, { status: 404 });
  if (signup.status === "added") return NextResponse.json({ error: "This guest has already been added." }, { status: 409 });

  let playerId = selectedPlayerId;
  if (createProfile) {
    const names = signup.full_name.trim().split(/\s+/);
    const firstName = names.shift() ?? signup.full_name.trim();
    const fullName = signup.full_name.trim();
    const sameDisplayResult = await client.from("players").select("id").ilike("display_name", firstName).limit(1);
    const displayName = sameDisplayResult.data?.length ? fullName : firstName;
    const competitionRelation = signup.competitions as unknown as { location_id: string | null } | null;
    const playerResult = await client.from("players").insert({
      display_name: displayName,
      first_name: firstName,
      full_name: fullName,
      nickname: null,
      is_archived: false,
      owner_user_id: user.id,
      claimed_by: null,
      location_id: competitionRelation?.location_id ?? null,
      age_band: ageBand,
      guardian_consent: false,
    }).select("id").single();
    if (playerResult.error || !playerResult.data) return NextResponse.json({ error: playerResult.error?.message ?? "Player profile could not be created." }, { status: 400 });
    playerId = playerResult.data.id;
  }

  const existingEntry = await client.from("competition_entries").select("id,status").eq("competition_id", signup.competition_id).eq("player_id", playerId).maybeSingle();
  const entryPayload = {
    status: "approved",
    payment_status: signup.payment_status,
    payment_method: signup.payment_method,
    payment_amount_pence: signup.payment_amount_pence,
    paid_at: signup.paid_at,
    public_signup_id: signup.id,
    reviewed_at: new Date().toISOString(),
  };
  const entryResult = existingEntry.data
    ? await client.from("competition_entries").update(entryPayload).eq("id", existingEntry.data.id)
    : await client.from("competition_entries").insert({ competition_id: signup.competition_id, requester_user_id: null, player_id: playerId, ...entryPayload });
  if (entryResult.error) return NextResponse.json({ error: entryResult.error.message }, { status: 400 });
  await client.from("public_competition_signups").update({ status: "added", updated_at: new Date().toISOString() }).eq("id", signup.id);

  let invitationSent = false;
  let invitationError: string | null = null;
  if (createProfile && ageBand === "18_plus" && signup.email && hasMailerConfig()) {
    const nameParts = signup.full_name.trim().split(/\s+/);
    const firstName = nameParts.shift() ?? signup.full_name.trim();
    const secondName = nameParts.join(" ");
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://rf-club-app.vercel.app").replace(/\/$/, "");
    const query = new URLSearchParams({ email: signup.email, firstName, secondName, invite: "competition" });
    const registrationUrl = `${siteUrl}/auth/sign-up?${query.toString()}`;
    const fixtureUrl = `${siteUrl}/entrant/${signup.fixture_access_token}`;
    const competitionRelation = signup.competitions as unknown as { name: string; location_id: string | null } | null;
    const competitionName = competitionRelation?.name ?? "your competition";
    try {
      const emailResult = await sendEmail({
        to: signup.email,
        subject: "Complete your Rack & Frame registration",
        text: `Hi ${firstName},\n\nYour player profile has been created and added to ${competitionName}. You are already entered and your payment is recorded.\n\nYour private fixtures and result link (no app registration needed):\n${fixtureUrl}\n\nKeep that link private. You can optionally register for the Rack & Frame Club app here:\n${registrationUrl}\n\nUse the same name and select the existing profile when prompted.`,
        html: `<p>Hi ${escapeHtml(firstName)},</p><p>Your player profile has been created and added to <strong>${escapeHtml(competitionName)}</strong>. You are already entered and your payment is recorded.</p><p><a href="${escapeHtml(fixtureUrl)}" style="display:inline-block;background:#047857;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">View fixtures &amp; submit results</a></p><p>This private link works without app registration. Please do not share it with anyone else.</p><p>Optionally, <a href="${escapeHtml(registrationUrl)}">register for the Rack &amp; Frame Club app</a>. Use the same name and select the existing profile when prompted.</p>`,
      });
      invitationSent = true;
      await client.from("audit_logs").insert({
        actor_user_id: user.id,
        actor_email: user.email ?? null,
        actor_role: role,
        action: "email_invitation_sent",
        entity_type: "player",
        entity_id: playerId,
        summary: `Registration invitation sent to ${signup.email}.`,
        meta: {
          recipient: signup.email,
          subject: "Complete your Rack & Frame registration",
          provider: process.env.RESEND_API_KEY ? "Resend" : "Zoho SMTP",
          sender: process.env.EMAIL_FROM_ADDRESS ?? null,
          competition: competitionName,
          signup_id: signup.id,
          message_id: emailResult.messageId ?? null,
        },
      });
    } catch (error) {
      invitationError = error instanceof Error ? error.message : "Invitation email could not be sent.";
      await client.from("audit_logs").insert({
        actor_user_id: user.id,
        actor_email: user.email ?? null,
        actor_role: role,
        action: "email_invitation_failed",
        entity_type: "player",
        entity_id: playerId,
        summary: `Registration invitation to ${signup.email} failed.`,
        meta: {
          recipient: signup.email,
          subject: "Complete your Rack & Frame registration",
          provider: process.env.RESEND_API_KEY ? "Resend" : "Zoho SMTP",
          sender: process.env.EMAIL_FROM_ADDRESS ?? null,
          competition: competitionName,
          signup_id: signup.id,
          error: invitationError,
        },
      });
    }
  }
  return NextResponse.json({ ok: true, playerId, invitationSent, invitationError });
}
