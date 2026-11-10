import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();

async function authorizeSuperUser(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return { error: "Server is not configured.", status: 500 } as const;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Unauthorized.", status: 401 } as const;
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return { error: "Unauthorized.", status: 401 } as const;
  const appUserResult = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const isSuper = appUserResult.data?.role === "owner" || Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail);
  if (!isSuper) return { error: "Super User access required.", status: 403 } as const;
  return { client, user, role: String(appUserResult.data?.role ?? "owner") } as const;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeSuperUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [competitionsResult, entriesResult, exceptionsResult] = await Promise.all([
    auth.client
      .from("competitions")
      .select("id,name,sport_type")
      .eq("competition_format", "league")
      .neq("league_schedule_mode", "one_day")
      .eq("is_archived", false)
      .eq("is_completed", false)
      .order("name"),
    auth.client
      .from("competition_entries")
      .select("competition_id,player_id,players(id,display_name,full_name)")
      .eq("status", "approved"),
    auth.client
      .from("league_playing_window_exceptions")
      .select("id,competition_id,player_id,active_from,expires_on,note,created_at,updated_at")
      .order("expires_on", { ascending: false }),
  ]);
  const error = competitionsResult.error || entriesResult.error || exceptionsResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const competitionIds = new Set((competitionsResult.data ?? []).map((competition) => competition.id));
  return NextResponse.json({
    competitions: competitionsResult.data ?? [],
    entries: (entriesResult.data ?? []).filter((entry) => competitionIds.has(entry.competition_id)),
    exceptions: exceptionsResult.data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeSuperUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null);
  const competitionId = String(body?.competitionId ?? "").trim();
  const playerId = String(body?.playerId ?? "").trim();
  const activeFrom = String(body?.activeFrom ?? "").trim();
  const expiresOn = String(body?.expiresOn ?? "").trim();
  const note = String(body?.note ?? "").trim();
  const validDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!competitionId || !playerId || !validDate.test(activeFrom) || !validDate.test(expiresOn) || expiresOn < activeFrom) {
    return NextResponse.json({ error: "Choose a player, competition and valid exception dates." }, { status: 400 });
  }
  if (note.length < 5 || note.length > 300) {
    return NextResponse.json({ error: "Add a short reason between 5 and 300 characters." }, { status: 400 });
  }

  const [competitionResult, entryResult] = await Promise.all([
    auth.client
      .from("competitions")
      .select("id,name")
      .eq("id", competitionId)
      .eq("competition_format", "league")
      .neq("league_schedule_mode", "one_day")
      .eq("is_archived", false)
      .eq("is_completed", false)
      .maybeSingle(),
    auth.client
      .from("competition_entries")
      .select("id")
      .eq("competition_id", competitionId)
      .eq("player_id", playerId)
      .eq("status", "approved")
      .maybeSingle(),
  ]);
  if (competitionResult.error || entryResult.error) {
    return NextResponse.json({ error: competitionResult.error?.message || entryResult.error?.message }, { status: 400 });
  }
  if (!competitionResult.data || !entryResult.data) {
    return NextResponse.json({ error: "The player must be an approved entrant in an active weekly league." }, { status: 400 });
  }

  const upsertResult = await auth.client
    .from("league_playing_window_exceptions")
    .upsert({
      competition_id: competitionId,
      player_id: playerId,
      active_from: activeFrom,
      expires_on: expiresOn,
      note,
      created_by_user_id: auth.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "competition_id,player_id" })
    .select("id")
    .single();
  if (upsertResult.error) return NextResponse.json({ error: upsertResult.error.message }, { status: 400 });

  await auth.client.from("audit_logs").insert({
    actor_user_id: auth.user.id,
    actor_email: auth.user.email ?? null,
    actor_role: auth.role,
    action: "league_playing_window_exception_saved",
    entity_type: "player",
    entity_id: playerId,
    summary: `Early-play exception saved for ${competitionResult.data.name}.`,
    meta: { competition_id: competitionId, active_from: activeFrom, expires_on: expiresOn, note },
  });
  return NextResponse.json({ ok: true, id: upsertResult.data.id });
}

export async function DELETE(request: NextRequest) {
  const auth = await authorizeSuperUser(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return NextResponse.json({ error: "Exception id is required." }, { status: 400 });
  const deleteResult = await auth.client.from("league_playing_window_exceptions").delete().eq("id", id).select("player_id,competition_id").maybeSingle();
  if (deleteResult.error) return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
  if (!deleteResult.data) return NextResponse.json({ error: "Exception not found." }, { status: 404 });
  await auth.client.from("audit_logs").insert({
    actor_user_id: auth.user.id,
    actor_email: auth.user.email ?? null,
    actor_role: auth.role,
    action: "league_playing_window_exception_removed",
    entity_type: "player",
    entity_id: deleteResult.data.player_id,
    summary: "Early-play exception removed.",
    meta: { competition_id: deleteResult.data.competition_id },
  });
  return NextResponse.json({ ok: true });
}
