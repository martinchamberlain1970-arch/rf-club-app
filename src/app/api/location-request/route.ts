import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail =
  process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  "";

export async function POST(req: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const body = await req.json();
  const requesterEmail = String(body?.requesterEmail ?? "").trim().toLowerCase();
  const requesterFullName = String(body?.requesterFullName ?? "").trim();
  const requestedLocationName = String(body?.requestedLocationName ?? "").trim();
  const requesterUserId = body?.requesterUserId ? String(body.requesterUserId) : null;

  if (!requesterEmail || !requesterFullName || !requestedLocationName) {
    return NextResponse.json({ error: "Missing requester or location details." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const existingLoc = await adminClient
    .from("locations")
    .select("id,name")
    .ilike("name", requestedLocationName)
    .limit(1)
    .maybeSingle();
  if (existingLoc.data?.id) {
    return NextResponse.json({ error: `Location "${existingLoc.data.name}" already exists.` }, { status: 409 });
  }

  const ownerRes = await adminClient
    .from("app_users")
    .select("id,email,role")
    .or("role.eq.owner,role.eq.super")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let targetSuperUserId = ownerRes.data?.id ?? null;
  if (!targetSuperUserId && superAdminEmail) {
    const emailFallback = await adminClient
      .from("app_users")
      .select("id,email")
      .eq("email", superAdminEmail)
      .limit(1)
      .maybeSingle();
    if (!emailFallback.error && emailFallback.data?.id) {
      targetSuperUserId = emailFallback.data.id;
    }
  }

  if (ownerRes.error || !targetSuperUserId) {
    return NextResponse.json({ error: "Unable to find super user account." }, { status: 400 });
  }

  const duplicatePending = await adminClient
    .from("location_requests")
    .select("id")
    .eq("status", "pending")
    .ilike("requested_location_name", requestedLocationName)
    .limit(1)
    .maybeSingle();
  if (duplicatePending.data?.id) {
    return NextResponse.json({ error: "A pending request already exists for this location." }, { status: 409 });
  }

  const insert = await adminClient.from("location_requests").insert({
    requester_user_id: requesterUserId,
    requester_email: requesterEmail,
    requester_full_name: requesterFullName,
    requested_location_name: requestedLocationName,
    target_super_user_id: targetSuperUserId,
    status: "pending",
  });
  if (insert.error) {
    return NextResponse.json({ error: insert.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
