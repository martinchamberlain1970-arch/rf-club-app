import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const { id: competitionId } = await context.params;
  const [competitionResult, appUserResult] = await Promise.all([
    client.from("competitions").select("id,name,entry_fee_pence,signup_open,signup_deadline,max_entries,is_completed").eq("id", competitionId).maybeSingle(),
    client.from("app_users").select("linked_player_id,role").eq("id", user.id).maybeSingle(),
  ]);
  const competition = competitionResult.data;
  const appUser = appUserResult.data;
  if (!competition) return NextResponse.json({ error: "Competition not found." }, { status: 404 });
  if (!appUser?.linked_player_id) return NextResponse.json({ error: "Link your player profile before entering." }, { status: 409 });
  if (!competition.signup_open || competition.is_completed) return NextResponse.json({ error: "Sign-ups are closed." }, { status: 409 });
  if (competition.signup_deadline && new Date(competition.signup_deadline).getTime() < Date.now()) {
    return NextResponse.json({ error: "The sign-up deadline has passed." }, { status: 409 });
  }

  const amount = Number(competition.entry_fee_pence ?? 0);
  const existingResult = await client.from("competition_entries").select("id,status,payment_status").eq("competition_id", competitionId).eq("requester_user_id", user.id).maybeSingle();
  let entry = existingResult.data;
  if (entry?.payment_status === "paid") return NextResponse.json({ error: "Your entry is already paid." }, { status: 409 });

  if (!entry) {
    if (competition.max_entries) {
      const countResult = await client.from("competition_entries").select("id", { count: "exact", head: true }).eq("competition_id", competitionId).in("status", ["pending", "approved"]);
      if ((countResult.count ?? 0) >= competition.max_entries) return NextResponse.json({ error: "This competition is full." }, { status: 409 });
    }
    const insertResult = await client.from("competition_entries").insert({
      competition_id: competitionId,
      requester_user_id: user.id,
      player_id: appUser.linked_player_id,
      status: "pending",
      payment_status: amount > 0 ? "pending" : "not_required",
      payment_amount_pence: amount > 0 ? amount : null,
    }).select("id,status,payment_status").single();
    if (insertResult.error || !insertResult.data) return NextResponse.json({ error: insertResult.error?.message ?? "Entry could not be saved." }, { status: 400 });
    entry = insertResult.data;
  } else {
    await client.from("competition_entries").update({
      player_id: appUser.linked_player_id,
      status: entry.status === "withdrawn" || entry.status === "rejected" ? "pending" : entry.status,
      payment_status: amount > 0 ? "pending" : "not_required",
      payment_amount_pence: amount > 0 ? amount : null,
    }).eq("id", entry.id);
  }

  if (amount <= 0) return NextResponse.json({ ok: true });
  const autoApprove = appUser.role === "owner";
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user.email,
    client_reference_id: entry.id,
    metadata: { competitionEntryId: entry.id, competitionId, autoApprove: String(autoApprove) },
    line_items: [{ quantity: 1, price_data: { currency: "gbp", unit_amount: amount, product_data: { name: `${competition.name} entry fee`, metadata: { competitionId } } } }],
    success_url: `${req.nextUrl.origin}/signups?payment=success`,
    cancel_url: `${req.nextUrl.origin}/signups?payment=cancelled`,
  });
  await client.from("competition_entries").update({ stripe_checkout_session_id: session.id }).eq("id", entry.id);
  return NextResponse.json({ checkoutUrl: session.url });
}
