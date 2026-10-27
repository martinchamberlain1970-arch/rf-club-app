import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { nextSnookerHandicapReviewDate, scheduledSnookerHandicapReviewDate } from "@/lib/snooker-handicap-review-server";

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
    .select("created_at,meta")
    .eq("action", "snooker_handicap_scheduled_review")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  const lastReviewDate = result.data ? scheduledSnookerHandicapReviewDate(result.data) : null;
  const lastReviewedAt = lastReviewDate ? `${lastReviewDate}T12:00:00.000Z` : null;
  const nextReviewAt = lastReviewDate
    ? `${nextSnookerHandicapReviewDate(lastReviewedAt!, REVIEW_INTERVAL_DAYS)}T12:00:00.000Z`
    : null;
  const meta = (result.data?.meta ?? {}) as {
    reviewedPlayers?: number;
    changedPlayers?: number;
    refreshedFixtures?: number;
    emails?: { sent?: number; skipped?: number; failed?: number; notConfigured?: boolean; error?: string };
  };

  return NextResponse.json({
    lastReviewedAt,
    nextReviewAt,
    intervalDays: REVIEW_INTERVAL_DAYS,
    movementLimit: null,
    latestReview: result.data ? {
      reviewedPlayers: meta.reviewedPlayers ?? 0,
      changedPlayers: meta.changedPlayers ?? 0,
      refreshedFixtures: meta.refreshedFixtures ?? 0,
      emails: meta.emails ?? null,
    } : null,
  });
}
