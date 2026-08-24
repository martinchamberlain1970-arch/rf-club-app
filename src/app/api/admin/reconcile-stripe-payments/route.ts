import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe-server";

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
  const roleResult = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const role = String(roleResult.data?.role ?? "").toLowerCase();
  const isSuper = ["owner", "super"].includes(role) || Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail);
  if (!isSuper && role !== "admin") return null;
  return { client, user, role: isSuper ? "owner" : role };
}

type PaymentRow = {
  id: string;
  competition_id: string;
  public_signup_id?: string | null;
  stripe_checkout_session_id: string | null;
  payment_status: string;
  payment_method: string | null;
};

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const competitionId = String(body?.competitionId ?? "");
  if (!competitionId) return NextResponse.json({ error: "Competition is required." }, { status: 400 });

  const [competitionResult, entriesResult, signupsResult] = await Promise.all([
    auth.client.from("competitions").select("id,name,created_at").eq("id", competitionId).maybeSingle(),
    auth.client.from("competition_entries").select("id,competition_id,public_signup_id,stripe_checkout_session_id,payment_status,payment_method").eq("competition_id", competitionId),
    auth.client.from("public_competition_signups").select("id,competition_id,stripe_checkout_session_id,payment_status,payment_method").eq("competition_id", competitionId),
  ]);
  const firstError = competitionResult.error ?? entriesResult.error ?? signupsResult.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 400 });
  const competition = competitionResult.data;
  if (!competition) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

  const entries = (entriesResult.data ?? []) as PaymentRow[];
  const signups = (signupsResult.data ?? []) as PaymentRow[];
  const entryById = new Map(entries.map((row) => [row.id, row]));
  const signupById = new Map(signups.map((row) => [row.id, row]));
  const entryBySignupId = new Map(entries.filter((row) => row.public_signup_id).map((row) => [row.public_signup_id as string, row]));
  const stripe = getStripe();
  const matchedSessions = new Map<string, { id: string; amount: number | null; paidAt: string }>();
  const createdAfter = Math.max(0, Math.floor(new Date(competition.created_at).getTime() / 1000) - 86400);

  let scanned = 0;
  for await (const session of stripe.checkout.sessions.list({ limit: 100, created: { gte: createdAfter } })) {
    scanned += 1;
    if (scanned > 1000) break;
    if (session.payment_status !== "paid" || session.metadata?.competitionId !== competitionId) continue;
    const paidAt = new Date(session.created * 1000).toISOString();
    const payment = { id: session.id, amount: session.amount_total ?? null, paidAt };
    const signupId = session.metadata?.publicCompetitionSignupId || (session.client_reference_id && signupById.has(session.client_reference_id) ? session.client_reference_id : null);
    const entryId = session.metadata?.competitionEntryId || (session.client_reference_id && entryById.has(session.client_reference_id) ? session.client_reference_id : null);
    if (signupId && signupById.has(signupId)) {
      matchedSessions.set(`signup:${signupId}`, payment);
      const linkedEntry = entryBySignupId.get(signupId);
      if (linkedEntry) matchedSessions.set(`entry:${linkedEntry.id}`, payment);
    }
    if (entryId && entryById.has(entryId)) matchedSessions.set(`entry:${entryId}`, payment);
  }

  let updatedEntries = 0;
  let updatedSignups = 0;
  let confirmedPence = 0;
  for (const [target, session] of matchedSessions) {
    const [kind, id] = target.split(":");
    const table = kind === "entry" ? "competition_entries" : "public_competition_signups";
    const updateResult = await auth.client.from(table).update({
      payment_status: "paid",
      payment_method: "stripe",
      payment_amount_pence: session.amount,
      stripe_checkout_session_id: session.id,
      paid_at: session.paidAt,
      ...(kind === "signup" ? { updated_at: new Date().toISOString() } : {}),
    }).eq("id", id).eq("competition_id", competitionId);
    if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    if (kind === "entry") {
      updatedEntries += 1;
      confirmedPence += session.amount ?? 0;
    } else {
      updatedSignups += 1;
      if (!entryBySignupId.has(id)) confirmedPence += session.amount ?? 0;
    }
  }

  await auth.client.from("audit_logs").insert({
    actor_user_id: auth.user.id,
    actor_email: auth.user.email ?? null,
    actor_role: auth.role,
    action: "competition_stripe_reconciled",
    entity_type: "competition",
    entity_id: competitionId,
    summary: `Stripe reconciliation confirmed £${(confirmedPence / 100).toFixed(2)} for ${competition.name}.`,
    meta: { scanned_sessions: scanned, matched_sessions: new Set([...matchedSessions.values()].map((item) => item.id)).size, updated_entries: updatedEntries, updated_signups: updatedSignups, confirmed_pence: confirmedPence },
  });

  return NextResponse.json({ ok: true, competitionName: competition.name, scanned, matchedSessions: new Set([...matchedSessions.values()].map((item) => item.id)).size, updatedEntries, updatedSignups, confirmedPence });
}
