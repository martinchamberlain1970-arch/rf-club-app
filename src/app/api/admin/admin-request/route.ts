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

  const body = await req.json();
  const requestId = body?.requestId as string | undefined;
  const approve = body?.approve as boolean | undefined;
  const requesterUserId = body?.requesterUserId as string | undefined;
  if (!requestId || typeof approve !== "boolean" || !requesterUserId) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  let metadataWarning: string | null = null;
  if (approve) {
    const { error: roleError } = await adminClient.auth.admin.updateUserById(requesterUserId, {
      user_metadata: { role: "admin" },
    });
    if (roleError) {
      metadataWarning = roleError.message;
    }
    await adminClient.from("app_users").update({ role: "admin" }).eq("id", requesterUserId);
  }

  const { error } = await adminClient
    .from("admin_requests")
    .update({ status: approve ? "approved" : "rejected", approved_by_super_at: approve ? new Date().toISOString() : null })
    .eq("id", requestId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await adminClient.from("audit_logs").insert({
    actor_user_id: authData.user.id,
    actor_email: requesterEmail ?? null,
    actor_role: "owner",
    action: approve ? "admin_request_approved" : "admin_request_rejected",
    entity_type: "admin_request",
    entity_id: requestId,
    summary: approve ? "Administrator access request approved." : "Administrator access request rejected.",
    meta: { requesterUserId },
  });

  return NextResponse.json({ ok: true, warning: metadataWarning });
}
