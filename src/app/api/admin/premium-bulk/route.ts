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
  const enabled = Boolean(body?.enabled);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const usersRes = await adminClient.auth.admin.listUsers({ perPage: 1000, page: 1 });
  if (usersRes.error) {
    return NextResponse.json({ error: usersRes.error.message }, { status: 400 });
  }

  const users = usersRes.data?.users ?? [];
  for (const user of users) {
    await adminClient.auth.admin.updateUserById(user.id, {
      user_metadata: { premium_unlocked: enabled },
    });
  }

  const appUserUpdate = await adminClient.from("app_users").update({ premium_unlocked: enabled });
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
    action: enabled ? "premium_enabled_bulk" : "premium_disabled_bulk",
    entity_type: "system",
    entity_id: "all_users",
    summary: enabled ? "Premium enabled for all users." : "Premium disabled for all users.",
    meta: { enabled, count: users.length },
  });

  return NextResponse.json({ ok: true, count: users.length });
}
