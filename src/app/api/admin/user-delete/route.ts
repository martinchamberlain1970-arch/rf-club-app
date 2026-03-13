import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();

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

  const requesterEmail = authData.user.email?.trim().toLowerCase();
  if (!superAdminEmail || requesterEmail !== superAdminEmail) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const userId = body?.userId as string | undefined;
  const reason = body?.reason as string | undefined;
  const context = body?.context as Record<string, unknown> | undefined;
  if (!userId) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (userId === authData.user.id) {
    return NextResponse.json({ error: "Super user account cannot be deleted." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: targetAuth, error: targetAuthError } = await adminClient.auth.admin.getUserById(userId);
  if (targetAuthError || !targetAuth?.user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const targetEmail = targetAuth.user.email?.trim().toLowerCase();
  if (targetEmail && targetEmail === superAdminEmail) {
    return NextResponse.json({ error: "Super user account cannot be deleted." }, { status: 400 });
  }

  const { error: clearClaimError } = await adminClient.from("players").update({ claimed_by: null }).eq("claimed_by", userId);
  if (clearClaimError) {
    return NextResponse.json({ error: `Failed clearing linked player claims: ${clearClaimError.message}` }, { status: 400 });
  }
  const { error: clearGuardianError } = await adminClient
    .from("players")
    .update({ guardian_user_id: null })
    .eq("guardian_user_id", userId);
  if (clearGuardianError) {
    return NextResponse.json({ error: `Failed clearing guardian links: ${clearGuardianError.message}` }, { status: 400 });
  }

  const { error: clearClaimRequestReviewerError } = await adminClient
    .from("player_claim_requests")
    .update({ reviewed_by_user_id: null })
    .eq("reviewed_by_user_id", userId);
  if (clearClaimRequestReviewerError) {
    return NextResponse.json(
      { error: `Failed clearing player claim reviewer links: ${clearClaimRequestReviewerError.message}` },
      { status: 400 }
    );
  }
  const { error: deleteClaimRequestsError } = await adminClient
    .from("player_claim_requests")
    .delete()
    .eq("requester_user_id", userId);
  if (deleteClaimRequestsError) {
    return NextResponse.json({ error: `Failed deleting player claim requests: ${deleteClaimRequestsError.message}` }, { status: 400 });
  }

  const { error: deleteAdminRequestsByRequesterError } = await adminClient
    .from("admin_requests")
    .delete()
    .eq("requester_user_id", userId);
  if (deleteAdminRequestsByRequesterError) {
    return NextResponse.json(
      { error: `Failed deleting admin requests (requester): ${deleteAdminRequestsByRequesterError.message}` },
      { status: 400 }
    );
  }
  const { error: deleteAdminRequestsByTargetError } = await adminClient
    .from("admin_requests")
    .delete()
    .eq("target_admin_user_id", userId);
  if (deleteAdminRequestsByTargetError) {
    return NextResponse.json(
      { error: `Failed deleting admin requests (target): ${deleteAdminRequestsByTargetError.message}` },
      { status: 400 }
    );
  }

  const { error: clearLinkError } = await adminClient.from("app_users").update({ linked_player_id: null }).eq("id", userId);
  if (clearLinkError) {
    return NextResponse.json({ error: `Failed clearing linked profile: ${clearLinkError.message}` }, { status: 400 });
  }

  const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteAuthError) {
    return NextResponse.json({ error: `Failed deleting user: ${deleteAuthError.message}` }, { status: 400 });
  }

  await adminClient.from("app_users").delete().eq("id", userId);

  const isProfileDeletionFlow = reason === "profile_deletion_approved";
  await adminClient.from("audit_logs").insert({
    actor_user_id: authData.user.id,
    actor_email: requesterEmail ?? null,
    actor_role: "owner",
    action: isProfileDeletionFlow ? "profile_deletion_user_removed" : "user_deleted",
    entity_type: "app_user",
    entity_id: userId,
    summary: isProfileDeletionFlow
      ? `Removed linked login ${targetEmail ?? userId} after profile deletion approval.`
      : `Deleted user ${targetEmail ?? userId}.`,
    meta: {
      deletedUserEmail: targetEmail ?? null,
      reason: reason ?? null,
      ...(context ?? {}),
    },
  });

  return NextResponse.json({ ok: true });
}
