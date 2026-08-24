import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendCompetitionWelcome } from "@/lib/competition-welcome";

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

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const auth = await authorizedClient(request);
  if (!auth) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { client } = auth;

  const result = await client
    .from("public_competition_signups")
    .select("id,competition_id,full_name,email,phone,note,status,payment_status,payment_method,payment_amount_pence,paid_at,stripe_checkout_session_id,created_at,competitions(name)")
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
    .select("id,competition_id,full_name,email,status,payment_status,payment_method,payment_amount_pence,paid_at,stripe_checkout_session_id,stripe_payment_intent_id,fixture_access_token,competitions(name,location_id)")
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
    stripe_checkout_session_id: signup.stripe_checkout_session_id,
    stripe_payment_intent_id: signup.stripe_payment_intent_id,
    public_signup_id: signup.id,
    reviewed_at: new Date().toISOString(),
  };
  const entryResult = existingEntry.data
    ? await client.from("competition_entries").update(entryPayload).eq("id", existingEntry.data.id).select("id").single()
    : await client.from("competition_entries").insert({ competition_id: signup.competition_id, requester_user_id: null, player_id: playerId, ...entryPayload }).select("id").single();
  if (entryResult.error) return NextResponse.json({ error: entryResult.error.message }, { status: 400 });
  await client.from("public_competition_signups").update({ status: "added", updated_at: new Date().toISOString() }).eq("id", signup.id);

  const welcome = await sendCompetitionWelcome(client, entryResult.data.id, { user, role });
  const invitationSent = welcome.status === "sent" || welcome.status === "already_sent";
  const invitationError = welcome.status === "failed" ? welcome.error : welcome.status === "no_email" ? "No email address is available." : welcome.status === "not_configured" ? "Resend is not configured." : null;
  return NextResponse.json({ ok: true, playerId, invitationSent, invitationError, welcomeStatus: welcome.status });
}
