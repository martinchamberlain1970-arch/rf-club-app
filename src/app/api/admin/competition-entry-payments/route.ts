import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function POST(request: NextRequest) {
  const auth = await authorizedClient(request);
  if (!auth) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { client, user, role } = auth;
  const body = await request.json().catch(() => null);
  const entryId = String(body?.entryId ?? "");
  const signupId = String(body?.signupId ?? "");
  const action = body?.action === "reset_cash_payment" ? "reset_cash_payment" : "mark_cash_paid";
  if (!entryId && !signupId) return NextResponse.json({ error: "Competition entry is required." }, { status: 400 });

  if (signupId) {
    const signupResult = await client
      .from("public_competition_signups")
      .select("id,competition_id,full_name,payment_status,payment_method,payment_amount_pence")
      .eq("id", signupId)
      .maybeSingle();
    if (signupResult.error) return NextResponse.json({ error: signupResult.error.message }, { status: 400 });
    const signup = signupResult.data;
    if (!signup) return NextResponse.json({ error: "Public signup was not found." }, { status: 404 });

    const competitionResult = await client.from("competitions").select("name,entry_fee_pence").eq("id", signup.competition_id).maybeSingle();
    const amount = Number(signup.payment_amount_pence ?? competitionResult.data?.entry_fee_pence ?? 0) || null;
    if (action === "reset_cash_payment" && signup.payment_method !== "cash") {
      return NextResponse.json({ error: "Only a cash payment can be reset here." }, { status: 409 });
    }
    const paidAt = action === "mark_cash_paid" ? new Date().toISOString() : null;
    const paymentUpdate = action === "mark_cash_paid"
      ? { payment_status: "paid", payment_method: "cash", payment_amount_pence: amount, paid_at: paidAt }
      : { payment_status: amount ? "pending" : "not_required", payment_method: null, payment_amount_pence: amount, paid_at: null };
    const updateResult = await client
      .from("public_competition_signups")
      .update({ ...paymentUpdate, updated_at: new Date().toISOString() })
      .eq("id", signup.id);
    if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    await client.from("competition_entries").update(paymentUpdate).eq("public_signup_id", signup.id);

    await client.from("audit_logs").insert({
      actor_user_id: user.id,
      actor_email: user.email ?? null,
      actor_role: role,
      action: action === "mark_cash_paid" ? "competition_entry_cash_paid" : "competition_entry_cash_payment_reset",
      entity_type: "public_competition_signup",
      entity_id: signup.id,
      summary: action === "mark_cash_paid"
        ? `${signup.full_name} marked as paid by cash for ${competitionResult.data?.name ?? "competition"}.`
        : `${signup.full_name}'s cash payment was reset for ${competitionResult.data?.name ?? "competition"}.`,
      meta: { competition_id: signup.competition_id, amount_pence: amount },
    });
    return NextResponse.json({ ok: true, payment: paymentUpdate });
  }

  const entryResult = await client
    .from("competition_entries")
    .select("id,competition_id,player_id,payment_status,payment_method,payment_amount_pence,public_signup_id")
    .eq("id", entryId)
    .maybeSingle();
  if (entryResult.error) return NextResponse.json({ error: entryResult.error.message }, { status: 400 });
  const entry = entryResult.data;
  if (!entry) return NextResponse.json({ error: "Competition entry was not found." }, { status: 404 });

  const competitionResult = await client.from("competitions").select("name,entry_fee_pence").eq("id", entry.competition_id).maybeSingle();
  const playerResult = await client.from("players").select("full_name,display_name").eq("id", entry.player_id).maybeSingle();
  const amount = Number(entry.payment_amount_pence ?? competitionResult.data?.entry_fee_pence ?? 0) || null;
  const paidAt = action === "mark_cash_paid" ? new Date().toISOString() : null;

  if (action === "reset_cash_payment" && entry.payment_method !== "cash") {
    return NextResponse.json({ error: "Only a cash payment can be reset here." }, { status: 409 });
  }

  const paymentUpdate = action === "mark_cash_paid"
    ? { payment_status: "paid", payment_method: "cash", payment_amount_pence: amount, paid_at: paidAt }
    : { payment_status: amount ? "pending" : "not_required", payment_method: null, payment_amount_pence: amount, paid_at: null };
  const updateResult = await client.from("competition_entries").update(paymentUpdate).eq("id", entry.id);
  if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 400 });

  if (entry.public_signup_id) {
    await client
      .from("public_competition_signups")
      .update({ ...paymentUpdate, updated_at: new Date().toISOString() })
      .eq("id", entry.public_signup_id);
  }

  const playerName = playerResult.data?.full_name?.trim() || playerResult.data?.display_name || "Competition entrant";
  const competitionName = competitionResult.data?.name ?? "competition";
  await client.from("audit_logs").insert({
    actor_user_id: user.id,
    actor_email: user.email ?? null,
    actor_role: role,
    action: action === "mark_cash_paid" ? "competition_entry_cash_paid" : "competition_entry_cash_payment_reset",
    entity_type: "competition_entry",
    entity_id: entry.id,
    summary: action === "mark_cash_paid"
      ? `${playerName} marked as paid by cash for ${competitionName}.`
      : `${playerName}'s cash payment was reset for ${competitionName}.`,
    meta: { competition_id: entry.competition_id, player_id: entry.player_id, amount_pence: amount, public_signup_id: entry.public_signup_id },
  });

  return NextResponse.json({ ok: true, payment: paymentUpdate });
}
