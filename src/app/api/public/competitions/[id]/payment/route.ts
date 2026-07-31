import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }
  const { id: competitionId } = await context.params;
  const body = await req.json().catch(() => null);
  const signupId = String(body?.signupId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(signupId)) {
    return NextResponse.json({ error: "Invalid signup reference." }, { status: 400 });
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const [signupResult, competitionResult] = await Promise.all([
    client
      .from("public_competition_signups")
      .select("id,email,payment_status,payment_amount_pence")
      .eq("id", signupId)
      .eq("competition_id", competitionId)
      .maybeSingle(),
    client.from("competitions").select("id,name,entry_fee_pence,signup_open,is_completed").eq("id", competitionId).maybeSingle(),
  ]);
  const signup = signupResult.data;
  const competition = competitionResult.data;
  if (!signup || !competition) return NextResponse.json({ error: "Signup not found." }, { status: 404 });
  if (signup.payment_status === "paid") return NextResponse.json({ error: "This entry is already paid." }, { status: 409 });
  if (!competition.signup_open || competition.is_completed) return NextResponse.json({ error: "Payments are closed." }, { status: 409 });

  const amount = Number(competition.entry_fee_pence ?? signup.payment_amount_pence ?? 0);
  if (amount < 30) return NextResponse.json({ error: "No payment is required." }, { status: 409 });

  const stripe = getStripe();
  const origin = req.nextUrl.origin;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: signup.email || undefined,
    client_reference_id: signup.id,
    metadata: { publicCompetitionSignupId: signup.id, competitionId },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "gbp",
        unit_amount: amount,
        product_data: { name: `${competition.name} entry fee`, metadata: { competitionId } },
      },
    }],
    success_url: `${origin}/join/${competitionId}?payment=success&signup=${signup.id}`,
    cancel_url: `${origin}/join/${competitionId}?payment=cancelled&signup=${signup.id}`,
  });
  await client
    .from("public_competition_signups")
    .update({
      payment_status: "pending",
      payment_amount_pence: amount,
      stripe_checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", signup.id);
  return NextResponse.json({ checkoutUrl: session.url });
}

