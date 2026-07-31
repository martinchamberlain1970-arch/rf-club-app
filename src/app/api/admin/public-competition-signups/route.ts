import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (
  process.env.SUPER_ADMIN_EMAIL ??
  process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ??
  process.env.NEXT_PUBLIC_OWNER_EMAIL ??
  ""
).trim().toLowerCase();

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const appUserResult = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const role = String(appUserResult.data?.role ?? "").toLowerCase();
  const isOwner = Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail);
  if (!isOwner && !["admin", "owner", "super"].includes(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const result = await client
    .from("public_competition_signups")
    .select("id,competition_id,full_name,email,phone,note,status,payment_status,payment_amount_pence,paid_at,created_at,competitions(name)")
    .order("created_at", { ascending: false });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ entries: result.data ?? [] });
}
