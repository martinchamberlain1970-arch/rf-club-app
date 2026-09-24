import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { nextMondayDate, runSnookerHandicapReview } from "@/lib/snooker-handicap-review-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail =
  process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  "";

export async function POST(req: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const requesterEmail = authData.user.email?.trim().toLowerCase() ?? "";
  if (!superAdminEmail || requesterEmail !== superAdminEmail) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const payload = (await req.json().catch(() => ({}))) as { playerId?: string | null };
  const playerId = payload.playerId?.trim() || null;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  let result: Awaited<ReturnType<typeof runSnookerHandicapReview>>;
  const effectiveFrom = nextMondayDate();
  try {
    result = await runSnookerHandicapReview(adminClient, {
      playerId,
      effectiveFrom,
      reason: playerId ? "Manual new-player Elo recalculation" : "Manual full Elo handicap review",
      changedBy: authData.user.id,
    });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to recalculate handicaps." }, { status: 400 });
  }

  await adminClient.from("audit_logs").insert({
    actor_user_id: authData.user.id,
    actor_email: requesterEmail,
    actor_role: "owner",
    action: "snooker_handicap_review",
    entity_type: "app_user",
    entity_id: authData.user.id,
    summary: playerId ? "One player handicap recalculated from Elo." : `Snooker handicaps recalculated from Elo for ${result.reviewedPlayers} players.`,
    meta: { ...result, playerId, effectiveFrom },
  });

  return NextResponse.json({ ok: true, ...result, effectiveFrom });
}
