import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REVIEW_INTERVAL_DAYS = 28;

export const dynamic = "force-dynamic";

export async function GET() {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result = await client
    .from("audit_logs")
    .select("created_at")
    .eq("action", "snooker_handicap_scheduled_review")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  const lastReviewedAt = result.data?.created_at ?? null;
  const nextReviewAt = lastReviewedAt
    ? new Date(new Date(lastReviewedAt).getTime() + REVIEW_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    : null;

  return NextResponse.json({
    lastReviewedAt,
    nextReviewAt,
    intervalDays: REVIEW_INTERVAL_DAYS,
    movementLimit: null,
  });
}
