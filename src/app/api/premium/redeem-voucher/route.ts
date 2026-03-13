import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function validVoucherCodes(): string[] {
  const raw = process.env.PREMIUM_VOUCHER_CODES ?? "";
  return raw
    .split(/[\n,]/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

export async function POST(req: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const voucherCode = String(body?.voucherCode ?? "").trim().toUpperCase();
  if (!voucherCode) {
    return NextResponse.json({ error: "Enter a voucher code." }, { status: 400 });
  }

  const allowedCodes = validVoucherCodes();
  if (!allowedCodes.length) {
    return NextResponse.json({ error: "Voucher codes are not configured." }, { status: 400 });
  }
  if (!allowedCodes.includes(voucherCode)) {
    return NextResponse.json({ error: "That voucher code is not valid." }, { status: 400 });
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const userId = authData.user.id;
  const email = authData.user.email?.trim().toLowerCase() ?? null;

  const authUpdate = await adminClient.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...(authData.user.user_metadata ?? {}),
      premium_unlocked: true,
      premium_voucher_redeemed: true,
    },
  });
  if (authUpdate.error) {
    return NextResponse.json({ error: authUpdate.error.message }, { status: 400 });
  }

  const appUserUpdate = await adminClient
    .from("app_users")
    .update({ premium_unlocked: true })
    .eq("id", userId);
  if (appUserUpdate.error) {
    const message = appUserUpdate.error.message.toLowerCase();
    if (!message.includes("column") || !message.includes("premium_unlocked")) {
      return NextResponse.json({ error: appUserUpdate.error.message }, { status: 400 });
    }
  }

  await adminClient.from("premium_requests").update({ status: "approved" }).eq("requester_user_id", userId).eq("status", "pending");

  await adminClient.from("audit_logs").insert({
    actor_user_id: userId,
    actor_email: email,
    actor_role: "user",
    action: "premium_enabled_voucher",
    entity_type: "app_user",
    entity_id: userId,
    summary: "Premium enabled using voucher code.",
    meta: {
      voucherCodeMasked: `${voucherCode.slice(0, 2)}***${voucherCode.slice(-2)}`,
    },
  });

  return NextResponse.json({ ok: true });
}
