import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  currentLondonDate,
  nextSnookerHandicapReviewDate,
  runSnookerHandicapReview,
  scheduledSnookerHandicapReviewDate,
} from "@/lib/snooker-handicap-review-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;
const REVIEW_INTERVAL_DAYS = 28;

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const authorized = cronSecret ? authHeader === cronSecret : Boolean(request.headers.get("x-vercel-cron"));
  if (!authorized) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const latestResult = await client
    .from("audit_logs")
    .select("created_at,meta")
    .eq("action", "snooker_handicap_scheduled_review")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestResult.error) return NextResponse.json({ error: latestResult.error.message }, { status: 400 });
  const lastReviewDate = latestResult.data ? scheduledSnookerHandicapReviewDate(latestResult.data) : null;
  const today = currentLondonDate();
  const nextReviewDate = lastReviewDate
    ? nextSnookerHandicapReviewDate(`${lastReviewDate}T12:00:00.000Z`, REVIEW_INTERVAL_DAYS)
    : today;
  if (today < nextReviewDate) {
    return NextResponse.json({ ok: true, reviewed: false, lastReviewDate, nextReviewDate });
  }

  // Use the scheduled Sunday as the effective date even when this daily safety
  // check is catching up after Vercel missed the original invocation.
  const effectiveFrom = nextReviewDate;
  try {
    const result = await runSnookerHandicapReview(client, {
      effectiveFrom,
      reason: "Automatic four-week Elo handicap review",
    });
    const auditResult = await client.from("audit_logs").insert({
      actor_role: "system",
      action: "snooker_handicap_scheduled_review",
      entity_type: "competition",
      summary: `Automatic four-week snooker handicap review completed for ${result.reviewedPlayers} players.`,
      meta: { ...result, effectiveFrom, caughtUpOn: today === effectiveFrom ? null : today },
    });
    if (auditResult.error) return NextResponse.json({ error: auditResult.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, reviewed: true, ...result, effectiveFrom });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Automatic handicap review failed." }, { status: 400 });
  }
}
