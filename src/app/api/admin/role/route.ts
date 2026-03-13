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
  const role = body?.role as "admin" | "user" | undefined;
  if (!userId || !role) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (requesterEmail && authData.user.id === userId && role !== "admin") {
    return NextResponse.json({ error: "Super admin cannot remove own admin role." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  let metadataWarning: string | null = null;
  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: { role },
  });
  if (error) {
    metadataWarning = error.message;
  }

  const appUserUpdate = await adminClient.from("app_users").update({ role }).eq("id", userId);
  if (appUserUpdate.error) {
    // Ignore missing column errors to keep backward compatibility.
    const message = appUserUpdate.error.message.toLowerCase();
    if (!message.includes("column") || !message.includes("role")) {
      return NextResponse.json({ error: appUserUpdate.error.message }, { status: 400 });
    }
  }

  await adminClient.from("audit_logs").insert({
    actor_user_id: authData.user.id,
    actor_email: requesterEmail ?? null,
    actor_role: "owner",
    action: "role_updated",
    entity_type: "app_user",
    entity_id: userId,
    summary: `Role changed to ${role}.`,
    meta: { role },
  });

  return NextResponse.json({ ok: true, warning: metadataWarning });
}
