import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();

type RowCount = { table: string; count: number };

function isMissingTableError(message: string) {
  const m = message.toLowerCase();
  return m.includes("does not exist") || m.includes("could not find the table");
}

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
  const requesterEmail = authData.user.email?.trim().toLowerCase() ?? "";
  if (!superAdminEmail || requesterEmail !== superAdminEmail) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await req.json();
  const keepAccounts = body?.keepAccounts !== false;
  const confirmText = String(body?.confirmText ?? "");
  if (confirmText !== "DELETE ALL DATA") {
    return NextResponse.json({ error: "Confirmation text mismatch." }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const exportTables = [
    "players",
    "locations",
    "competitions",
    "matches",
    "frames",
    "result_submissions",
    "player_claim_requests",
    "player_update_requests",
    "premium_requests",
    "admin_requests",
    "location_requests",
  ] as const;

  const backupPayload: Record<string, unknown> = {
    version: "clear-data-1",
    exported_at: new Date().toISOString(),
    requested_by_user_id: authData.user.id,
    requested_by_email: requesterEmail,
    keep_accounts: keepAccounts,
  };

  for (const table of exportTables) {
    const { data, error } = await adminClient.from(table).select("*");
    if (error && !isMissingTableError(error.message)) {
      return NextResponse.json({ error: `Backup failed on ${table}: ${error.message}` }, { status: 400 });
    }
    backupPayload[table] = data ?? [];
  }

  const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: "application/json" });
  const backupPath = `system/clear-data-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const upload = await adminClient.storage.from("backups").upload(backupPath, blob, {
    upsert: true,
    contentType: "application/json",
  });
  if (upload.error) {
    return NextResponse.json({ error: `Automatic backup failed: ${upload.error.message}` }, { status: 400 });
  }

  const deleted: RowCount[] = [];
  const deleteAll = async (table: string, idColumn = "id") => {
    const { data, error } = await adminClient
      .from(table)
      .delete()
      .neq(idColumn, "00000000-0000-0000-0000-000000000000")
      .select(idColumn);
    if (error) {
      if (isMissingTableError(error.message)) return;
      throw new Error(`${table}: ${error.message}`);
    }
    deleted.push({ table, count: Array.isArray(data) ? data.length : 0 });
  };

  try {
    // Break FK links from app_users -> players before deleting players.
    {
      const unlink = await adminClient.from("app_users").update({ linked_player_id: null }).not("linked_player_id", "is", null);
      if (unlink.error && !isMissingTableError(unlink.error.message)) {
        throw new Error(`app_users unlink failed: ${unlink.error.message}`);
      }
    }

    await deleteAll("result_submissions");
    await deleteAll("frames");
    await deleteAll("matches");
    await deleteAll("competitions");
    await deleteAll("player_update_requests");
    await deleteAll("player_claim_requests");
    await deleteAll("premium_requests");
    await deleteAll("admin_requests");
    await deleteAll("location_requests");
    await deleteAll("players");
    await deleteAll("locations");

    if (!keepAccounts) {
      const { data: appUsers, error } = await adminClient.from("app_users").select("id,email");
      if (error && !isMissingTableError(error.message)) {
        throw new Error(`app_users read failed: ${error.message}`);
      }
      const users = (appUsers ?? []) as { id: string; email: string | null }[];
      const toRemove = users.filter((u) => (u.email ?? "").toLowerCase() !== superAdminEmail);
      for (const u of toRemove) {
        await adminClient.from("app_users").delete().eq("id", u.id);
        await adminClient.auth.admin.deleteUser(u.id);
      }
      deleted.push({ table: "auth.users", count: toRemove.length });
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        error: `Clear data failed after backup: ${errorMessage}`,
        backupPath,
      },
      { status: 400 }
    );
  }

  await adminClient.from("audit_logs").insert({
    actor_user_id: authData.user.id,
    actor_email: requesterEmail,
    actor_role: "owner",
    action: "system_clear_data",
    entity_type: "system",
    entity_id: "clear_data",
    summary: "System clear-data executed (with automatic backup).",
    meta: { keepAccounts, backupPath, deleted },
  });

  return NextResponse.json({
    ok: true,
    backupPath,
    keepAccounts,
    deleted,
  });
}
