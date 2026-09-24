import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { nextMondayDate, runSnookerHandicapReview } from "@/lib/snooker-handicap-review-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;
const REVIEW_INTERVAL_MS = 28 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const authorized = cronSecret ? authHeader === cronSecret : Boolean(request.headers.get("x-vercel-cron"));
  if (!authorized) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const latestResult = await client
    .from("audit_logs")
    .select("created_at")
    .eq("action", "snooker_handicap_scheduled_review")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestResult.error) return NextResponse.json({ error: latestResult.error.message }, { status: 400 });
  const lastReviewAt = latestResult.data?.created_at ? new Date(latestResult.data.created_at) : null;
  if (lastReviewAt && Date.now() - lastReviewAt.getTime() < REVIEW_INTERVAL_MS) {
    return NextResponse.json({ ok: true, reviewed: false, lastReviewAt: lastReviewAt.toISOString() });
  }

  const effectiveFrom = nextMondayDate();
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
      meta: { ...result, effectiveFrom },
    });
    if (auditResult.error) return NextResponse.json({ error: auditResult.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, reviewed: true, ...result, effectiveFrom });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Automatic handicap review failed." }, { status: 400 });
  }
}
