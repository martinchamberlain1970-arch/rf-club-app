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
  const userId = body?.userId as string | undefined;
  const enabled = Boolean(body?.enabled);
  if (!userId) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: { premium_unlocked: enabled },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const appUserUpdate = await adminClient.from("app_users").update({ premium_unlocked: enabled }).eq("id", userId);
  if (appUserUpdate.error) {
    const message = appUserUpdate.error.message.toLowerCase();
    if (!message.includes("column") || !message.includes("premium_unlocked")) {
      return NextResponse.json({ error: appUserUpdate.error.message }, { status: 400 });
    }
  }

  await adminClient.from("audit_logs").insert({
    actor_user_id: authData.user.id,
    actor_email: requesterEmail ?? null,
    actor_role: "owner",
    action: enabled ? "premium_enabled" : "premium_disabled",
    entity_type: "app_user",
    entity_id: userId,
    summary: enabled ? "Premium enabled for user." : "Premium disabled for user.",
    meta: { enabled },
  });

  return NextResponse.json({ ok: true });
}
