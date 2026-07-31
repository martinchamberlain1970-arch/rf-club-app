import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!webhookSecret || !signature || !supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 400 });
  }

  try {
    const stripe = getStripe();
    const event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object;
      const signupId = session.metadata?.publicCompetitionSignupId;
      if (signupId && session.payment_status === "paid") {
        await client
          .from("public_competition_signups")
          .update({
            payment_status: "paid",
            payment_amount_pence: session.amount_total ?? null,
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", signupId);
      }
    }

    if (event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object;
      const signupId = session.metadata?.publicCompetitionSignupId;
      if (signupId) {
        await client
          .from("public_competition_signups")
          .update({ payment_status: "failed", updated_at: new Date().toISOString() })
          .eq("id", signupId);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook could not be processed." },
      { status: 400 }
    );
  }
}

