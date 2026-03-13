import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  const body = await req.json().catch(() => ({}));
  const playerId = (body?.playerId as string | undefined) ?? null;
  const locationId = (body?.locationId as string | undefined) ?? null;
  if (!playerId || !locationId) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: playersAtLocation, error: playersErr } = await adminClient
    .from("players")
    .select("id")
    .eq("location_id", locationId)
    .eq("is_archived", false);
  if (playersErr) return NextResponse.json({ error: playersErr.message }, { status: 400 });
  const ids = (playersAtLocation ?? []).map((p) => p.id);
  let hasAdmin = false;
  if (ids.length) {
    const { data: admins, error: adminErr } = await adminClient
      .from("app_users")
      .select("id")
      .in("linked_player_id", ids)
      .in("role", ["admin", "owner"])
      .limit(1);
    if (adminErr) return NextResponse.json({ error: adminErr.message }, { status: 400 });
    hasAdmin = (admins ?? []).length > 0;
  }
  if (hasAdmin) {
    return NextResponse.json({ error: "Location already has an admin." }, { status: 409 });
  }

  const userId = authData.user.id;
  await adminClient.from("players").update({ claimed_by: userId, location_id: locationId }).eq("id", playerId);
  const appUpdate = await adminClient
    .from("app_users")
    .update({ linked_player_id: playerId, role: "admin" })
    .eq("id", userId);
  if (appUpdate.error) return NextResponse.json({ error: appUpdate.error.message }, { status: 400 });

  await adminClient.auth.admin.updateUserById(userId, { user_metadata: { role: "admin" } });
  await adminClient.from("audit_logs").insert({
    actor_user_id: userId,
    actor_email: authData.user.email ?? null,
    actor_role: "admin",
    action: "auto_admin_bootstrap",
    entity_type: "location",
    entity_id: locationId,
    summary: "User auto-promoted as first admin at location.",
    meta: { playerId },
  });

  return NextResponse.json({ ok: true });
}

