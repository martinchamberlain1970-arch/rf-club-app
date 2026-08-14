import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_OWNER_EMAIL ?? "").trim().toLowerCase();

async function authorize(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return null;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return null;
  const appUserResult = await client.from("app_users").select("role,linked_player_id").eq("id", user.id).maybeSingle();
  const role = String(appUserResult.data?.role ?? "").toLowerCase();
  const isSuper = ["owner", "super"].includes(role) || Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail);
  return { client, user, role, isSuper, playerId: appUserResult.data?.linked_player_id as string | null };
}

async function eligibility(auth: NonNullable<Awaited<ReturnType<typeof authorize>>>) {
  const sports = new Set<string>();
  if (auth.isSuper) {
    sports.add("pool");
    sports.add("snooker");
  }
  if (auth.playerId) {
    const [mastersResult, grantsResult] = await Promise.all([
      auth.client
        .from("competition_entries")
        .select("id,competitions!inner(name)")
        .eq("player_id", auth.playerId)
        .eq("status", "approved")
        .ilike("competitions.name", "Greenhithe Legion Masters 2026"),
      auth.client.from("table_booking_access").select("sport_type,access_role").eq("player_id", auth.playerId),
    ]);
    if (mastersResult.error) throw mastersResult.error;
    if (grantsResult.error) throw grantsResult.error;
    if ((mastersResult.data ?? []).length) sports.add("pool");
    for (const grant of grantsResult.data ?? []) sports.add(grant.sport_type);
  }
  return [...sports];
}

function londonDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[part("weekday")],
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

function timeMinutes(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Sign in to view table bookings." }, { status: 401 });
  const eligibleSports = await eligibility(auth);
  const now = new Date();
  const from = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const [tablesResult, reservationsResult, hoursResult, blocksResult] = await Promise.all([
    auth.client.from("cue_tables").select("id,name,sport_type,location_id,display_order").eq("is_active", true).order("display_order"),
    auth.client.from("table_reservations").select("id,table_id,booked_by_user_id,booked_for_player_id,starts_at,ends_at,purpose,notes,status,created_at").eq("status", "booked").gte("ends_at", from).lte("starts_at", to).order("starts_at"),
    auth.client.from("table_booking_hours").select("id,table_id,weekday,opens_at,closes_at").order("weekday"),
    auth.client.from("table_booking_blocks").select("id,table_id,starts_at,ends_at,category,title,notes,created_at").gte("ends_at", from).lte("starts_at", to).order("starts_at"),
  ]);
  const error = tablesResult.error || reservationsResult.error || hoursResult.error || blocksResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const playerIds = [...new Set((reservationsResult.data ?? []).map((reservation) => reservation.booked_for_player_id))];
  const namesResult = playerIds.length ? await auth.client.from("players").select("id,display_name,full_name").in("id", playerIds) : { data: [], error: null };
  if (namesResult.error) return NextResponse.json({ error: namesResult.error.message }, { status: 400 });
  const names = new Map((namesResult.data ?? []).map((player) => [player.id, player.full_name?.trim() || player.display_name]));

  let access: unknown[] = [];
  let players: unknown[] = [];
  if (auth.isSuper) {
    const tableLocationIds = [...new Set((tablesResult.data ?? []).map((table) => table.location_id))];
    const [accessResult, playersResult] = await Promise.all([
      auth.client.from("table_booking_access").select("id,player_id,sport_type,access_role,created_at").order("created_at"),
      tableLocationIds.length
        ? auth.client.from("players").select("id,display_name,full_name,location_id").eq("is_archived", false).in("location_id", tableLocationIds).order("display_name")
        : Promise.resolve({ data: [], error: null }),
    ]);
    const managementError = accessResult.error || playersResult.error;
    if (managementError) return NextResponse.json({ error: managementError.message }, { status: 400 });
    players = playersResult.data ?? [];
    const playerNameMap = new Map((playersResult.data ?? []).map((player) => [player.id, player.full_name?.trim() || player.display_name]));
    access = (accessResult.data ?? []).map((grant) => ({ ...grant, playerName: playerNameMap.get(grant.player_id) || "Player" }));
  }

  return NextResponse.json({
    isSuper: auth.isSuper,
    playerId: auth.playerId,
    eligibleSports,
    tables: tablesResult.data ?? [],
    reservations: (reservationsResult.data ?? []).map((reservation) => ({ ...reservation, playerName: names.get(reservation.booked_for_player_id) || "Player" })),
    availability: hoursResult.data ?? [],
    blocks: blocksResult.data ?? [],
    access,
    players,
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Sign in to manage table bookings." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "book");

  if (action === "grant_access" || action === "revoke_access") {
    if (!auth.isSuper) return NextResponse.json({ error: "Super User access required." }, { status: 403 });
    const playerId = String(body?.playerId ?? "");
    const sportType = String(body?.sportType ?? "");
    const accessRole = String(body?.accessRole ?? "");
    if (!playerId || !["pool", "snooker"].includes(sportType)) return NextResponse.json({ error: "Choose a player and sport." }, { status: 400 });
    if (action === "revoke_access") {
      const result = await auth.client.from("table_booking_access").delete().eq("player_id", playerId).eq("sport_type", sportType);
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    if (!["captain", "vice_captain"].includes(accessRole)) return NextResponse.json({ error: "Choose captain or vice-captain." }, { status: 400 });
    const [playerResult, tableResult] = await Promise.all([
      auth.client.from("players").select("location_id").eq("id", playerId).maybeSingle(),
      auth.client.from("cue_tables").select("location_id").eq("sport_type", sportType).eq("is_active", true),
    ]);
    if (playerResult.error || tableResult.error) return NextResponse.json({ error: playerResult.error?.message || tableResult.error?.message }, { status: 400 });
    const playerLocationId = playerResult.data?.location_id;
    if (!playerLocationId || !(tableResult.data ?? []).some((table) => table.location_id === playerLocationId)) {
      return NextResponse.json({ error: "That player is not registered at the club where this table is located." }, { status: 400 });
    }
    const result = await auth.client.from("table_booking_access").upsert({ player_id: playerId, sport_type: sportType, access_role: accessRole, granted_by_user_id: auth.user.id }, { onConflict: "player_id,sport_type" });
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (action === "set_availability") {
    if (!auth.isSuper) return NextResponse.json({ error: "Super User access required." }, { status: 403 });
    const tableId = String(body?.tableId ?? "");
    const weekday = Number(body?.weekday);
    const enabled = Boolean(body?.enabled);
    const opensAt = String(body?.opensAt ?? "").slice(0, 5);
    const closesAt = String(body?.closesAt ?? "").slice(0, 5);
    if (!tableId || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return NextResponse.json({ error: "Choose a valid table and day." }, { status: 400 });
    if (enabled && (!validTime(opensAt) || !validTime(closesAt) || timeMinutes(closesAt) <= timeMinutes(opensAt))) return NextResponse.json({ error: "Choose valid opening and closing times." }, { status: 400 });
    const tableResult = await auth.client.from("cue_tables").select("id").eq("id", tableId).eq("is_active", true).maybeSingle();
    if (!tableResult.data) return NextResponse.json({ error: "That table is not available." }, { status: 404 });
    const now = new Date();
    const futureReservations = await auth.client.from("table_reservations").select("starts_at,ends_at").eq("table_id", tableId).eq("status", "booked").gte("ends_at", now.toISOString()).lte("starts_at", new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString());
    if (futureReservations.error) return NextResponse.json({ error: futureReservations.error.message }, { status: 400 });
    const affected = (futureReservations.data ?? []).filter((reservation) => {
      const start = londonDateParts(new Date(reservation.starts_at));
      if (start.weekday !== weekday) return false;
      const end = londonDateParts(new Date(reservation.ends_at));
      return !enabled || start.date !== end.date || start.minutes < timeMinutes(opensAt) || end.minutes > timeMinutes(closesAt);
    });
    if (affected.length) return NextResponse.json({ error: `This change would put ${affected.length} existing reservation${affected.length === 1 ? "" : "s"} outside the available hours. Cancel or move them first.` }, { status: 409 });
    const deleteResult = await auth.client.from("table_booking_hours").delete().eq("table_id", tableId).eq("weekday", weekday);
    if (deleteResult.error) return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    if (enabled) {
      const insertResult = await auth.client.from("table_booking_hours").insert({ table_id: tableId, weekday, opens_at: opensAt, closes_at: closesAt, updated_at: new Date().toISOString() });
      if (insertResult.error) return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
    }
    await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: "table_availability_updated", entity_type: "cue_table", entity_id: tableId, summary: `Table booking availability ${enabled ? `set to ${opensAt}-${closesAt}` : "closed"} for weekday ${weekday}.`, meta: { weekday, enabled, opens_at: enabled ? opensAt : null, closes_at: enabled ? closesAt : null } });
    return NextResponse.json({ ok: true });
  }

  if (action === "add_block") {
    if (!auth.isSuper) return NextResponse.json({ error: "Super User access required." }, { status: 403 });
    const tableId = body?.tableId ? String(body.tableId) : null;
    const startsAt = new Date(String(body?.startsAt ?? ""));
    const endsAt = new Date(String(body?.endsAt ?? ""));
    const category = String(body?.category ?? "other");
    const title = String(body?.title ?? "").trim().slice(0, 120);
    const notes = String(body?.notes ?? "").trim().slice(0, 240) || null;
    const categories = ["entertainment", "pool_home_match", "snooker_home_match", "maintenance", "private_event", "other"];
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return NextResponse.json({ error: "Choose a valid unavailable period." }, { status: 400 });
    if (!categories.includes(category) || !title) return NextResponse.json({ error: "Choose a reason and enter a title." }, { status: 400 });
    if (tableId) {
      const tableResult = await auth.client.from("cue_tables").select("id").eq("id", tableId).eq("is_active", true).maybeSingle();
      if (!tableResult.data) return NextResponse.json({ error: "That table is not available." }, { status: 404 });
    }
    let conflictQuery = auth.client.from("table_reservations").select("id", { count: "exact", head: true }).eq("status", "booked").lt("starts_at", endsAt.toISOString()).gt("ends_at", startsAt.toISOString());
    if (tableId) conflictQuery = conflictQuery.eq("table_id", tableId);
    const conflicts = await conflictQuery;
    if (conflicts.error) return NextResponse.json({ error: conflicts.error.message }, { status: 400 });
    if ((conflicts.count ?? 0) > 0) return NextResponse.json({ error: `There ${conflicts.count === 1 ? "is" : "are"} ${conflicts.count} existing reservation${conflicts.count === 1 ? "" : "s"} in that period. Cancel or move them before making the table unavailable.` }, { status: 409 });
    const insertResult = await auth.client.from("table_booking_blocks").insert({ table_id: tableId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), category, title, notes, created_by_user_id: auth.user.id }).select("id").single();
    if (insertResult.error) return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
    await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: "table_booking_block_added", entity_type: "table_booking_block", entity_id: insertResult.data.id, summary: `Table booking blocked: ${title}.`, meta: { table_id: tableId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), category } });
    return NextResponse.json({ ok: true });
  }

  if (action === "remove_block") {
    if (!auth.isSuper) return NextResponse.json({ error: "Super User access required." }, { status: 403 });
    const blockId = String(body?.blockId ?? "");
    const deleteResult = await auth.client.from("table_booking_blocks").delete().eq("id", blockId);
    if (deleteResult.error) return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: "table_booking_block_removed", entity_type: "table_booking_block", entity_id: blockId, summary: "Table booking block removed." });
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel") {
    const reservationId = String(body?.reservationId ?? "");
    const reservationResult = await auth.client.from("table_reservations").select("booked_by_user_id").eq("id", reservationId).maybeSingle();
    if (!reservationResult.data || (!auth.isSuper && reservationResult.data.booked_by_user_id !== auth.user.id)) return NextResponse.json({ error: "You cannot cancel this reservation." }, { status: 403 });
    const result = await auth.client.from("table_reservations").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by_user_id: auth.user.id }).eq("id", reservationId);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (!auth.playerId) return NextResponse.json({ error: "Link your app account to a player profile before booking." }, { status: 409 });
  const tableId = String(body?.tableId ?? "");
  const startsAt = new Date(String(body?.startsAt ?? ""));
  const endsAt = new Date(String(body?.endsAt ?? ""));
  const purpose = ["fixture", "league_match", "practice", "other"].includes(body?.purpose) ? body.purpose : "fixture";
  const notes = String(body?.notes ?? "").trim().slice(0, 240) || null;
  if (!tableId || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return NextResponse.json({ error: "Choose a valid table, date and time." }, { status: 400 });
  const durationMinutes = (endsAt.getTime() - startsAt.getTime()) / 60000;
  if (startsAt.getTime() < Date.now() - 5 * 60000 || durationMinutes < 30 || durationMinutes > 240) return NextResponse.json({ error: "Bookings must be between 30 minutes and 4 hours and cannot start in the past." }, { status: 400 });
  if (startsAt.getTime() > Date.now() + 60 * 24 * 60 * 60 * 1000) return NextResponse.json({ error: "Bookings can be made up to 60 days ahead." }, { status: 400 });
  const startInLondon = londonDateParts(startsAt);
  const tableResult = await auth.client.from("cue_tables").select("id,sport_type,is_active").eq("id", tableId).maybeSingle();
  if (!tableResult.data?.is_active) return NextResponse.json({ error: "That table is not available." }, { status: 404 });
  const maximumMinutes = tableResult.data.sport_type === "pool" ? 30 : 60;
  if (!auth.isSuper && durationMinutes > maximumMinutes) return NextResponse.json({ error: `${tableResult.data.sport_type === "pool" ? "Pool" : "Snooker"} table bookings are limited to ${maximumMinutes} minutes.` }, { status: 400 });
  const eligibleSports = await eligibility(auth);
  if (!eligibleSports.includes(tableResult.data.sport_type)) return NextResponse.json({ error: `You do not currently have ${tableResult.data.sport_type} table booking access.` }, { status: 403 });
  const endInLondon = londonDateParts(endsAt);
  const hoursResult = await auth.client.from("table_booking_hours").select("opens_at,closes_at").eq("table_id", tableId).eq("weekday", startInLondon.weekday).maybeSingle();
  if (hoursResult.error) return NextResponse.json({ error: hoursResult.error.message }, { status: 400 });
  const withinHours = hoursResult.data && startInLondon.date === endInLondon.date && startInLondon.minutes >= timeMinutes(hoursResult.data.opens_at) && endInLondon.minutes <= timeMinutes(hoursResult.data.closes_at);
  if (!withinHours) {
    const hours = hoursResult.data ? `${hoursResult.data.opens_at.slice(0, 5)}–${hoursResult.data.closes_at.slice(0, 5)}` : "closed";
    return NextResponse.json({ error: `This table is not available for that whole period. Its booking hours on ${startInLondon.date} are ${hours}.` }, { status: 409 });
  }
  const blockResult = await auth.client.from("table_booking_blocks").select("title").or(`table_id.is.null,table_id.eq.${tableId}`).lt("starts_at", endsAt.toISOString()).gt("ends_at", startsAt.toISOString()).limit(1).maybeSingle();
  if (blockResult.error) return NextResponse.json({ error: blockResult.error.message }, { status: 400 });
  if (blockResult.data) return NextResponse.json({ error: `This table is unavailable then: ${blockResult.data.title}.` }, { status: 409 });
  const insertResult = await auth.client.from("table_reservations").insert({ table_id: tableId, booked_by_user_id: auth.user.id, booked_for_player_id: auth.playerId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), purpose, notes }).select("id").single();
  if (insertResult.error) {
    if (insertResult.error.code === "23P01") return NextResponse.json({ error: "That table is already reserved during this time." }, { status: 409 });
    return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
  }
  await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: "table_reserved", entity_type: "table_reservation", entity_id: insertResult.data.id, summary: `Cue table reserved from ${startsAt.toISOString()} to ${endsAt.toISOString()}.`, meta: { table_id: tableId, player_id: auth.playerId, purpose } });
  return NextResponse.json({ ok: true, id: insertResult.data.id });
}
