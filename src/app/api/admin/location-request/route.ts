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
  if (!token) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const requesterEmail = authData.user.email?.trim().toLowerCase() ?? "";
  if (!superAdminEmail || requesterEmail !== superAdminEmail) {
    return NextResponse.json({ error: "Only the super user can review location requests." }, { status: 403 });
  }

  const body = await req.json();
  const requestId = String(body?.requestId ?? "").trim();
  const approve = Boolean(body?.approve);
  if (!requestId) return NextResponse.json({ error: "requestId is required." }, { status: 400 });

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const reqRes = await adminClient
    .from("location_requests")
    .select("id,status,requested_location_name")
    .eq("id", requestId)
    .maybeSingle();
  if (reqRes.error || !reqRes.data) {
    return NextResponse.json({ error: reqRes.error?.message ?? "Request not found." }, { status: 404 });
  }
  if (reqRes.data.status !== "pending") {
    return NextResponse.json({ error: "Request is no longer pending." }, { status: 400 });
  }

  let createdLocationId: string | null = null;
  if (approve) {
    const existing = await adminClient
      .from("locations")
      .select("id,name")
      .ilike("name", reqRes.data.requested_location_name)
      .limit(1)
      .maybeSingle();
    if (existing.error) {
      return NextResponse.json({ error: existing.error.message }, { status: 400 });
    }
    if (existing.data?.id) {
      createdLocationId = existing.data.id;
    } else {
      const createLoc = await adminClient
        .from("locations")
        .insert({ name: reqRes.data.requested_location_name })
        .select("id")
        .single();
      if (createLoc.error || !createLoc.data?.id) {
        return NextResponse.json({ error: createLoc.error?.message ?? "Failed to create location." }, { status: 400 });
      }
      createdLocationId = createLoc.data.id;
    }
  }

  const update = await adminClient
    .from("location_requests")
    .update({
      status: approve ? "approved" : "rejected",
      reviewed_by_user_id: authData.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending");
  if (update.error) {
    return NextResponse.json({ error: update.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, locationId: createdLocationId });
}

