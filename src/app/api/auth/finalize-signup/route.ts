import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ExistingPayload = {
  type: "existing";
  playerId: string;
  fullName: string;
  locationId?: string;
  autoRequestAdmin?: boolean;
};

type CreatePayload = {
  type: "create";
  firstName: string;
  secondName?: string;
  locationId?: string;
  autoRequestAdmin?: boolean;
  ageBand?: "under_13" | "13_15" | "16_17" | "18_plus";
  guardianConsent?: boolean;
  guardianName?: string;
  guardianEmail?: string;
  guardianUserId?: string;
};

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

  const body = (await req.json().catch(() => null)) as
    | {
        createdUserId?: string;
        email?: string;
        payload?: ExistingPayload | CreatePayload;
      }
    | null;

  const createdUserId = body?.createdUserId?.trim();
  const email = body?.email?.trim().toLowerCase() ?? null;
  const payload = body?.payload;
  if (!createdUserId || !payload) {
    return NextResponse.json({ error: "Invalid signup finalization request." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const upsertAppUserLink = async (playerId: string) => {
    const { data: existingUser } = await adminClient
      .from("app_users")
      .select("id")
      .eq("id", createdUserId)
      .maybeSingle();

    if (existingUser?.id) {
      return adminClient.from("app_users").update({ linked_player_id: playerId }).eq("id", createdUserId);
    }

    return adminClient.from("app_users").insert({
      id: createdUserId,
      email,
      role: "user",
      linked_player_id: playerId,
    });
  };

  const maybeCreateAdminRequest = async (locationId?: string) => {
    if (!locationId || !payload.autoRequestAdmin || !superAdminEmail) return;

    const { data: superUser } = await adminClient
      .from("app_users")
      .select("id")
      .eq("email", superAdminEmail)
      .maybeSingle();

    if (!superUser?.id) return;

    const { data: existing } = await adminClient
      .from("admin_requests")
      .select("id")
      .eq("requester_user_id", createdUserId)
      .eq("location_id", locationId)
      .eq("status", "pending")
      .limit(1);

    if ((existing ?? []).length > 0) return;

    await adminClient.from("admin_requests").insert({
      requester_user_id: createdUserId,
      target_admin_user_id: superUser.id,
      location_id: locationId,
      status: "pending",
    });
  };

  if (payload.type === "existing") {
    const { data: existingClaim } = await adminClient
      .from("player_claim_requests")
      .select("id")
      .eq("player_id", payload.playerId)
      .eq("requester_user_id", createdUserId)
      .eq("status", "pending")
      .limit(1);

    if ((existingClaim ?? []).length === 0) {
      const { error: claimError } = await adminClient.from("player_claim_requests").insert({
        player_id: payload.playerId,
        requester_user_id: createdUserId,
        requested_full_name: payload.fullName,
        status: "pending",
      });
      if (claimError) {
        return NextResponse.json({ error: claimError.message }, { status: 400 });
      }
    }

    if (payload.locationId) {
      const { data: existingUpdate } = await adminClient
        .from("player_update_requests")
        .select("id")
        .eq("player_id", payload.playerId)
        .eq("requester_user_id", createdUserId)
        .eq("status", "pending")
        .limit(1);

      if ((existingUpdate ?? []).length === 0) {
        await adminClient.from("player_update_requests").insert({
          player_id: payload.playerId,
          requester_user_id: createdUserId,
          requested_full_name: null,
          requested_location_id: payload.locationId,
          status: "pending",
        });
      }
    }

    await maybeCreateAdminRequest(payload.locationId);
    return NextResponse.json({ ok: true, mode: "claim" });
  }

  const effectiveAgeBand = payload.ageBand ?? "18_plus";
  const fullName =
    effectiveAgeBand === "18_plus" ? `${payload.firstName} ${payload.secondName ?? ""}`.trim() : payload.firstName;

  const { data: linkedExisting } = await adminClient
    .from("app_users")
    .select("linked_player_id")
    .eq("id", createdUserId)
    .maybeSingle();

  if (linkedExisting?.linked_player_id) {
    return NextResponse.json({ ok: true, mode: "linked", playerId: linkedExisting.linked_player_id });
  }

  const { data: alreadyClaimed } = await adminClient
    .from("players")
    .select("id")
    .eq("claimed_by", createdUserId)
    .limit(1)
    .maybeSingle();

  if (alreadyClaimed?.id) {
    await upsertAppUserLink(alreadyClaimed.id);
    return NextResponse.json({ ok: true, mode: "linked", playerId: alreadyClaimed.id });
  }

  const { data: createdPlayer, error: createError } = await adminClient
    .from("players")
    .insert({
      display_name: payload.firstName,
      first_name: payload.firstName,
      nickname: null,
      full_name: fullName,
      is_archived: false,
      claimed_by: createdUserId,
      location_id: effectiveAgeBand === "18_plus" ? payload.locationId ?? null : null,
      age_band: effectiveAgeBand,
      guardian_consent: effectiveAgeBand === "18_plus" ? false : Boolean(payload.guardianConsent),
      guardian_consent_at:
        effectiveAgeBand === "18_plus" ? null : Boolean(payload.guardianConsent) ? new Date().toISOString() : null,
      guardian_name: payload.guardianName ?? null,
      guardian_email: payload.guardianEmail ?? null,
      guardian_user_id: payload.guardianUserId ?? null,
    })
    .select("id")
    .single();

  if (createError || !createdPlayer?.id) {
    return NextResponse.json({ error: createError?.message ?? "Unable to create player profile." }, { status: 400 });
  }

  const linkResult = await upsertAppUserLink(createdPlayer.id);
  if (linkResult.error) {
    return NextResponse.json({ error: linkResult.error.message }, { status: 400 });
  }

  await maybeCreateAdminRequest(payload.locationId);

  return NextResponse.json({ ok: true, mode: "created", playerId: createdPlayer.id });
}
