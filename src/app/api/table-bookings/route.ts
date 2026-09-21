import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToUserIds } from "@/lib/push-server";

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
  let canBookOther = auth.isSuper;
  if (auth.isSuper) {
    sports.add("pool");
    sports.add("snooker");
  }
  if (auth.playerId) {
    const [mastersResult, grantsResult] = await Promise.all([
      auth.client
        .from("competition_entries")
        .select("id,competitions!inner(name,sport_type)")
        .eq("player_id", auth.playerId)
        .eq("status", "approved")
        .ilike("competitions.name", "Greenhithe Legion Masters%2026"),
      auth.client.from("table_booking_access").select("sport_type,access_role").eq("player_id", auth.playerId),
    ]);
    if (mastersResult.error) throw mastersResult.error;
    if (grantsResult.error) throw grantsResult.error;
    for (const entry of mastersResult.data ?? []) {
      const competition = entry.competitions as unknown as { sport_type?: string } | null;
      if (competition?.sport_type === "snooker") sports.add("snooker");
      if (["pool_8_ball", "pool_9_ball"].includes(competition?.sport_type ?? "")) sports.add("pool");
    }
    for (const grant of grantsResult.data ?? []) {
      sports.add(grant.sport_type);
      if (["captain", "vice_captain"].includes(grant.access_role)) canBookOther = true;
    }
  }
  return { eligibleSports: [...sports], canBookOther };
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

function missingTemporaryHoursTable(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "PGRST205" || Boolean(error?.message?.includes("table_booking_hour_overrides"));
}

async function effectiveBookingHours(
  client: NonNullable<Awaited<ReturnType<typeof authorize>>>["client"],
  tableId: string,
  date: string,
  weekday: number
) {
  const overrideResult = await client
    .from("table_booking_hour_overrides")
    .select("is_closed,opens_at,closes_at")
    .eq("table_id", tableId)
    .eq("weekday", weekday)
    .lte("starts_on", date)
    .gte("ends_on", date)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (overrideResult.error && !missingTemporaryHoursTable(overrideResult.error)) throw overrideResult.error;
  if (overrideResult.data) {
    return overrideResult.data.is_closed ? null : overrideResult.data;
  }
  const normalResult = await client.from("table_booking_hours").select("opens_at,closes_at").eq("table_id", tableId).eq("weekday", weekday).maybeSingle();
  if (normalResult.error) throw normalResult.error;
  return normalResult.data;
}

const bookingTitle = (reservation: { purpose: string; participant_one?: string | null; participant_two?: string | null; team_name?: string | null; notes?: string | null }) => reservation.purpose === "league_match"
  ? reservation.team_name || "League team booking"
  : reservation.purpose === "other"
    ? reservation.notes || "Other table booking"
    : [reservation.participant_one, reservation.participant_two].filter(Boolean).join(" vs. ") || "Competition booking";
const londonBookingTime = (startsAt: string, endsAt: string) => `${new Date(startsAt).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}–${new Date(endsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}`;

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Sign in to view table bookings." }, { status: 401 });
  const { eligibleSports, canBookOther } = await eligibility(auth);
  const now = new Date();
  const from = now.toISOString();
  const bookingViewDays = auth.isSuper ? 400 : 60;
  const to = new Date(now.getTime() + bookingViewDays * 24 * 60 * 60 * 1000).toISOString();
  let reservationsQuery = auth.client.from("table_reservations").select("id,table_id,booked_by_user_id,booked_for_player_id,starts_at,ends_at,purpose,notes,status,created_at,participant_one,participant_two,team_name,requester_email,rejection_reason,reviewed_at,competition_id,participant_one_player_id,participant_two_player_id").gt("ends_at", from).lte("starts_at", to).order("starts_at");
  if (!auth.isSuper) reservationsQuery = reservationsQuery.or(`status.eq.booked,booked_by_user_id.eq.${auth.user.id}`);
  const [tablesResult, reservationsResult, hoursResult, blocksResult, temporaryHoursResult] = await Promise.all([
    auth.client.from("cue_tables").select("id,name,sport_type,location_id,display_order").eq("is_active", true).order("display_order"),
    reservationsQuery,
    auth.client.from("table_booking_hours").select("id,table_id,weekday,opens_at,closes_at").order("weekday"),
    auth.client.from("table_booking_blocks").select("id,table_id,starts_at,ends_at,category,title,notes,created_at").gt("ends_at", from).lte("starts_at", to).order("starts_at"),
    auth.client.from("table_booking_hour_overrides").select("id,table_id,starts_on,ends_on,weekday,is_closed,opens_at,closes_at").gte("ends_on", now.toLocaleDateString("en-CA", { timeZone: "Europe/London" })).order("starts_on"),
  ]);
  const temporaryHoursError = missingTemporaryHoursTable(temporaryHoursResult.error) ? null : temporaryHoursResult.error;
  const error = tablesResult.error || reservationsResult.error || hoursResult.error || blocksResult.error || temporaryHoursError;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const playerIds = [...new Set((reservationsResult.data ?? []).flatMap((reservation) => [reservation.booked_for_player_id, reservation.participant_one_player_id, reservation.participant_two_player_id]).filter(Boolean))];
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

  const competitionsResult = await auth.client
    .from("competitions")
    .select("id,name,sport_type")
    .eq("is_archived", false)
    .eq("is_completed", false)
    .order("created_at", { ascending: false });
  if (competitionsResult.error) return NextResponse.json({ error: competitionsResult.error.message }, { status: 400 });
  const eligibleCompetitions = (competitionsResult.data ?? []).filter((competition) =>
    eligibleSports.includes(competition.sport_type === "snooker" ? "snooker" : "pool")
  );
  const competitionIds = eligibleCompetitions.map((competition) => competition.id);
  const entrantResult = competitionIds.length
    ? await auth.client
      .from("competition_entries")
      .select("competition_id,player_id,players(id,display_name,full_name)")
      .in("competition_id", competitionIds)
      .eq("status", "approved")
    : { data: [], error: null };
  if (entrantResult.error) return NextResponse.json({ error: entrantResult.error.message }, { status: 400 });
  const entrantRows = entrantResult.data ?? [];
  const visibleCompetitionIds = auth.isSuper
    ? new Set(competitionIds)
    : new Set(entrantRows.filter((entry) => entry.player_id === auth.playerId).map((entry) => entry.competition_id));
  const bookingCompetitions = eligibleCompetitions
    .filter((competition) => visibleCompetitionIds.has(competition.id))
    .map((competition) => ({
      ...competition,
      players: entrantRows
        .filter((entry) => entry.competition_id === competition.id)
        .map((entry) => {
          const player = entry.players as unknown as { id: string; display_name: string; full_name: string | null } | null;
          return player ? { id: player.id, name: player.full_name?.trim() || player.display_name } : null;
        })
        .filter((player): player is { id: string; name: string } => Boolean(player))
        .sort((left, right) => left.name.localeCompare(right.name)),
    }));

  return NextResponse.json({
    isSuper: auth.isSuper,
    userId: auth.user.id,
    playerId: auth.playerId,
    eligibleSports,
    canBookOther,
    tables: tablesResult.data ?? [],
    reservations: (reservationsResult.data ?? []).map((reservation) => ({
      ...reservation,
      requester_email: auth.isSuper || reservation.booked_by_user_id === auth.user.id ? reservation.requester_email : null,
      playerName: names.get(reservation.booked_for_player_id) || "Player",
      participant_one: reservation.participant_one || names.get(reservation.participant_one_player_id) || null,
      participant_two: reservation.participant_two || names.get(reservation.participant_two_player_id) || null,
    })),
    availability: hoursResult.data ?? [],
    temporaryAvailability: temporaryHoursError ? [] : temporaryHoursResult.data ?? [],
    blocks: blocksResult.data ?? [],
    access,
    players,
    competitions: bookingCompetitions,
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

  if (action === "set_weekly_availability") {
    if (!auth.isSuper) return NextResponse.json({ error: "Super User access required." }, { status: 403 });
    const tableId = String(body?.tableId ?? "");
    const hours: unknown[] = Array.isArray(body?.hours) ? body.hours : [];
    const normalizedHours: Array<{ weekday: number; isClosed: boolean; opensAt: string | null; closesAt: string | null }> = hours.map((entry: unknown) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const weekday = Number(row.weekday);
      const isClosed = Boolean(row.isClosed);
      const opensAt = isClosed ? null : String(row.opensAt ?? "").slice(0, 5);
      const closesAt = isClosed ? null : String(row.closesAt ?? "").slice(0, 5);
      return { weekday, isClosed, opensAt, closesAt };
    });
    if (!tableId || normalizedHours.length !== 7 || new Set(normalizedHours.map((entry) => entry.weekday)).size !== 7 || normalizedHours.some((entry) => entry.weekday < 0 || entry.weekday > 6 || (!entry.isClosed && (!validTime(entry.opensAt ?? "") || !validTime(entry.closesAt ?? "") || timeMinutes(entry.closesAt ?? "") <= timeMinutes(entry.opensAt ?? ""))))) {
      return NextResponse.json({ error: "Enter valid opening hours for every day from Monday to Sunday." }, { status: 400 });
    }
    const tableResult = await auth.client.from("cue_tables").select("id,name").eq("id", tableId).eq("is_active", true).maybeSingle();
    if (!tableResult.data) return NextResponse.json({ error: "That table is not available." }, { status: 404 });
    const now = new Date();
    const today = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const bookingHorizon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const horizonDate = bookingHorizon.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const [reservationsResult, overridesResult] = await Promise.all([
      auth.client.from("table_reservations").select("starts_at,ends_at").eq("table_id", tableId).eq("status", "booked").gte("ends_at", now.toISOString()).lte("starts_at", bookingHorizon.toISOString()),
      auth.client.from("table_booking_hour_overrides").select("starts_on,ends_on").eq("table_id", tableId).gte("ends_on", today).lte("starts_on", horizonDate),
    ]);
    if (reservationsResult.error) return NextResponse.json({ error: reservationsResult.error.message }, { status: 400 });
    if (overridesResult.error && !missingTemporaryHoursTable(overridesResult.error)) return NextResponse.json({ error: overridesResult.error.message }, { status: 400 });
    const datedPeriods = missingTemporaryHoursTable(overridesResult.error) ? [] : overridesResult.data ?? [];
    const affected = (reservationsResult.data ?? []).filter((reservation) => {
      const start = londonDateParts(new Date(reservation.starts_at));
      if (datedPeriods.some((period) => period.starts_on <= start.date && period.ends_on >= start.date)) return false;
      const end = londonDateParts(new Date(reservation.ends_at));
      const rule = normalizedHours.find((entry) => entry.weekday === start.weekday);
      return !rule || rule.isClosed || start.date !== end.date || start.minutes < timeMinutes(rule.opensAt ?? "00:00") || end.minutes > timeMinutes(rule.closesAt ?? "00:00");
    });
    if (affected.length) return NextResponse.json({ error: `These standard hours would put ${affected.length} existing reservation${affected.length === 1 ? "" : "s"} outside opening hours. Move or cancel them first.` }, { status: 409 });

    const deleteResult = await auth.client.from("table_booking_hours").delete().eq("table_id", tableId);
    if (deleteResult.error) return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    const openHours = normalizedHours.filter((entry) => !entry.isClosed).map((entry) => ({ table_id: tableId, weekday: entry.weekday, opens_at: entry.opensAt, closes_at: entry.closesAt, updated_at: new Date().toISOString() }));
    if (openHours.length) {
      const insertResult = await auth.client.from("table_booking_hours").insert(openHours);
      if (insertResult.error) return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
    }
    await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: "standard_table_availability_updated", entity_type: "cue_table", entity_id: tableId, summary: `Standard Monday-to-Sunday opening hours updated for ${tableResult.data.name}.`, meta: { hours: normalizedHours } });
    return NextResponse.json({ ok: true });
  }

  if (action === "set_temporary_availability") {
    if (!auth.isSuper) return NextResponse.json({ error: "Super User access required." }, { status: 403 });
    const tableId = String(body?.tableId ?? "");
    const startsOn = String(body?.startsOn ?? "");
    const endsOn = String(body?.endsOn ?? "");
    const hours: unknown[] = Array.isArray(body?.hours) ? body.hours : [];
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
    if (!tableId || !validDate(startsOn) || !validDate(endsOn) || endsOn < startsOn) return NextResponse.json({ error: "Choose a valid start and end date." }, { status: 400 });
    const rangeDays = Math.round((Date.parse(`${endsOn}T12:00:00Z`) - Date.parse(`${startsOn}T12:00:00Z`)) / 86_400_000) + 1;
    if (rangeDays > 366) return NextResponse.json({ error: "Temporary hours can cover a maximum of one year." }, { status: 400 });
    if (hours.length !== 7) return NextResponse.json({ error: "Enter opening hours for every day from Monday to Sunday." }, { status: 400 });
    const normalizedHours: Array<{ weekday: number; isClosed: boolean; opensAt: string | null; closesAt: string | null }> = hours.map((entry: unknown) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const weekday = Number(row.weekday);
      const isClosed = Boolean(row.isClosed);
      const opensAt = isClosed ? null : String(row.opensAt ?? "").slice(0, 5);
      const closesAt = isClosed ? null : String(row.closesAt ?? "").slice(0, 5);
      return { weekday, isClosed, opensAt, closesAt };
    });
    if (new Set(normalizedHours.map((entry) => entry.weekday)).size !== 7 || normalizedHours.some((entry) => entry.weekday < 0 || entry.weekday > 6 || (!entry.isClosed && (!validTime(entry.opensAt ?? "") || !validTime(entry.closesAt ?? "") || timeMinutes(entry.closesAt ?? "") <= timeMinutes(entry.opensAt ?? ""))))) {
      return NextResponse.json({ error: "Check the Monday-to-Sunday opening and closing times." }, { status: 400 });
    }
    const tableResult = await auth.client.from("cue_tables").select("id,name").eq("id", tableId).eq("is_active", true).maybeSingle();
    if (!tableResult.data) return NextResponse.json({ error: "That table is not available." }, { status: 404 });
    const overlapResult = await auth.client.from("table_booking_hour_overrides").select("id,starts_on,ends_on").eq("table_id", tableId).lte("starts_on", endsOn).gte("ends_on", startsOn);
    if (overlapResult.error) return NextResponse.json({ error: missingTemporaryHoursTable(overlapResult.error) ? "Run the temporary opening-hours database migration first." : overlapResult.error.message }, { status: 400 });
    const conflictingPeriod = (overlapResult.data ?? []).find((entry) => entry.starts_on !== startsOn || entry.ends_on !== endsOn);
    if (conflictingPeriod) return NextResponse.json({ error: `These dates overlap another temporary schedule (${conflictingPeriod.starts_on} to ${conflictingPeriod.ends_on}). Edit or remove that schedule first.` }, { status: 409 });

    const reservationsResult = await auth.client
      .from("table_reservations")
      .select("starts_at,ends_at")
      .eq("table_id", tableId)
      .eq("status", "booked")
      .gte("ends_at", `${startsOn}T00:00:00Z`)
      .lte("starts_at", `${endsOn}T23:59:59Z`);
    if (reservationsResult.error) return NextResponse.json({ error: reservationsResult.error.message }, { status: 400 });
    const affected = (reservationsResult.data ?? []).filter((reservation) => {
      const start = londonDateParts(new Date(reservation.starts_at));
      const end = londonDateParts(new Date(reservation.ends_at));
      if (start.date < startsOn || start.date > endsOn) return false;
      const rule = normalizedHours.find((entry) => entry.weekday === start.weekday);
      return !rule || rule.isClosed || start.date !== end.date || start.minutes < timeMinutes(rule.opensAt ?? "00:00") || end.minutes > timeMinutes(rule.closesAt ?? "00:00");
    });
    if (affected.length) return NextResponse.json({ error: `This schedule would put ${affected.length} existing reservation${affected.length === 1 ? "" : "s"} outside the opening hours. Move or cancel them first.` }, { status: 409 });

    const deleteResult = await auth.client.from("table_booking_hour_overrides").delete().eq("table_id", tableId).eq("starts_on", startsOn).eq("ends_on", endsOn);
    if (deleteResult.error) return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    const insertResult = await auth.client.from("table_booking_hour_overrides").insert(normalizedHours.map((entry) => ({
      table_id: tableId,
      starts_on: startsOn,
      ends_on: endsOn,
      weekday: entry.weekday,
      is_closed: entry.isClosed,
      opens_at: entry.opensAt,
      closes_at: entry.closesAt,
      created_by_user_id: auth.user.id,
      updated_at: new Date().toISOString(),
    })));
    if (insertResult.error) return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
    await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: "temporary_table_availability_updated", entity_type: "cue_table", entity_id: tableId, summary: `Temporary opening hours set for ${tableResult.data.name}, ${startsOn} to ${endsOn}.`, meta: { starts_on: startsOn, ends_on: endsOn, hours: normalizedHours } });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete_temporary_availability") {
    if (!auth.isSuper) return NextResponse.json({ error: "Super User access required." }, { status: 403 });
    const tableId = String(body?.tableId ?? "");
    const startsOn = String(body?.startsOn ?? "");
    const endsOn = String(body?.endsOn ?? "");
    const deleteResult = await auth.client.from("table_booking_hour_overrides").delete().eq("table_id", tableId).eq("starts_on", startsOn).eq("ends_on", endsOn);
    if (deleteResult.error) return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: "temporary_table_availability_removed", entity_type: "cue_table", entity_id: tableId, summary: `Temporary opening hours removed for ${startsOn} to ${endsOn}.` });
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

  if (["approve", "reject", "delete"].includes(action)) {
    if (!auth.isSuper) return NextResponse.json({ error: "Super User access required." }, { status: 403 });
    const reservationId = String(body?.reservationId ?? "");
    const reason = String(body?.reason ?? "").trim().slice(0, 240) || null;
    if (action === "reject" && !reason) return NextResponse.json({ error: "Enter a reason or comment before declining the booking." }, { status: 400 });
    const reservationResult = await auth.client.from("table_reservations").select("id,table_id,booked_by_user_id,starts_at,ends_at,purpose,notes,participant_one,participant_two,team_name,requester_email,status,cue_tables(name)").eq("id", reservationId).maybeSingle();
    if (reservationResult.error) return NextResponse.json({ error: reservationResult.error.message }, { status: 400 });
    const reservation = reservationResult.data;
    if (!reservation) return NextResponse.json({ error: "Booking request not found." }, { status: 404 });
    if (action === "approve") {
      const startInLondon = londonDateParts(new Date(reservation.starts_at));
      const endInLondon = londonDateParts(new Date(reservation.ends_at));
      const [effectiveHours, blockResult] = await Promise.all([
        effectiveBookingHours(auth.client, reservation.table_id, startInLondon.date, startInLondon.weekday),
        auth.client.from("table_booking_blocks").select("title").or(`table_id.is.null,table_id.eq.${reservation.table_id}`).lt("starts_at", reservation.ends_at).gt("ends_at", reservation.starts_at).limit(1).maybeSingle(),
      ]);
      const approvalError = blockResult.error;
      if (approvalError) return NextResponse.json({ error: approvalError.message }, { status: 400 });
      const withinHours = effectiveHours && startInLondon.date === endInLondon.date && startInLondon.minutes >= timeMinutes(effectiveHours.opens_at) && endInLondon.minutes <= timeMinutes(effectiveHours.closes_at);
      if (!withinHours) return NextResponse.json({ error: "This request is now outside the table's published booking hours." }, { status: 409 });
      if (blockResult.data) return NextResponse.json({ error: `This request overlaps an unavailable period: ${blockResult.data.title}.` }, { status: 409 });
      const updateResult = await auth.client.from("table_reservations").update({ status: "booked", reviewed_at: new Date().toISOString(), reviewed_by_user_id: auth.user.id, rejection_reason: null }).eq("id", reservationId);
      if (updateResult.error) {
        if (updateResult.error.code === "23P01") return NextResponse.json({ error: "This request clashes with a booking that has already been accepted." }, { status: 409 });
        return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
      }
    } else if (action === "reject") {
      if (!reason) return NextResponse.json({ error: "Enter a reason for rejecting this request." }, { status: 400 });
      const updateResult = await auth.client.from("table_reservations").update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by_user_id: auth.user.id, rejection_reason: reason }).eq("id", reservationId);
      if (updateResult.error) return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    } else {
      const deleteResult = await auth.client.from("table_reservations").delete().eq("id", reservationId);
      if (deleteResult.error) return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    }
    const decision = action === "approve" ? "accepted" : action === "reject" ? "rejected" : "deleted";
    await auth.client.from("audit_logs").insert({
      actor_user_id: auth.user.id,
      actor_email: auth.user.email ?? null,
      actor_role: auth.role,
      action: `table_booking_${decision}`,
      entity_type: "table_reservation",
      entity_id: reservationId,
      summary: `Table booking ${decision}: ${bookingTitle(reservation)}.`,
      meta: {
        notification_type: "in_app",
        reason,
      },
    });
    await sendPushToUserIds(auth.client, [reservation.booked_by_user_id], {
      title: `Table booking ${decision}`,
      body: `${bookingTitle(reservation)} · ${londonBookingTime(reservation.starts_at, reservation.ends_at)}${reason ? ` · ${reason}` : ""}`,
      url: "/table-bookings",
      tag: `table-booking-${reservationId}`,
    });
    return NextResponse.json({ ok: true, notification: "in_app" });
  }

  if (action === "cancel") {
    const reservationId = String(body?.reservationId ?? "");
    const reservationResult = await auth.client.from("table_reservations").select("booked_by_user_id").eq("id", reservationId).maybeSingle();
    if (!reservationResult.data || (!auth.isSuper && reservationResult.data.booked_by_user_id !== auth.user.id)) return NextResponse.json({ error: "You cannot cancel this reservation." }, { status: 403 });
    const result = await auth.client.from("table_reservations").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by_user_id: auth.user.id }).eq("id", reservationId);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (!auth.playerId && !auth.isSuper) return NextResponse.json({ error: "Link your app account to a player profile before booking." }, { status: 409 });
  const editingReservationId = action === "edit" ? String(body?.reservationId ?? "") : null;
  if (action !== "book" && action !== "edit") return NextResponse.json({ error: "Unknown table-booking action." }, { status: 400 });
  if (editingReservationId) {
    const existingResult = await auth.client.from("table_reservations").select("id,booked_by_user_id,status").eq("id", editingReservationId).maybeSingle();
    if (existingResult.error) return NextResponse.json({ error: existingResult.error.message }, { status: 400 });
    if (!existingResult.data || existingResult.data.status !== "booked") return NextResponse.json({ error: "That confirmed booking could not be found." }, { status: 404 });
    if (!auth.isSuper && existingResult.data.booked_by_user_id !== auth.user.id) return NextResponse.json({ error: "Only the person who made this booking or the Super User can edit it." }, { status: 403 });
  }
  const tableId = String(body?.tableId ?? "");
  const startsAt = new Date(String(body?.startsAt ?? ""));
  const endsAt = new Date(String(body?.endsAt ?? ""));
  const requestedPurpose = String(body?.purpose ?? "fixture");
  const purpose = ["fixture", "league_match", "other"].includes(requestedPurpose) ? requestedPurpose : "fixture";
  const competitionId = purpose === "fixture" ? String(body?.competitionId ?? "") || null : null;
  const participantOnePlayerId = purpose === "fixture" ? String(body?.participantOnePlayerId ?? "") || null : null;
  const participantTwoPlayerId = purpose === "fixture" ? String(body?.participantTwoPlayerId ?? "") || null : null;
  let participantOne = String(body?.participantOne ?? "").trim().slice(0, 80) || null;
  let participantTwo = String(body?.participantTwo ?? "").trim().slice(0, 80) || null;
  const teamName = String(body?.teamName ?? "").trim().slice(0, 120) || null;
  const otherReason = String(body?.otherReason ?? "").trim().slice(0, 240) || null;
  if (purpose === "fixture" && (!competitionId || !participantOnePlayerId || !participantTwoPlayerId)) return NextResponse.json({ error: "Choose the competition and both players." }, { status: 400 });
  if (purpose === "fixture" && participantOnePlayerId === participantTwoPlayerId) return NextResponse.json({ error: "Choose two different players." }, { status: 400 });
  if (purpose === "league_match" && !teamName) return NextResponse.json({ error: "Enter the pool or snooker team name." }, { status: 400 });
  if (purpose === "other" && !otherReason) return NextResponse.json({ error: "Enter a reason for the other booking, such as team practice night." }, { status: 400 });
  if (!tableId || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return NextResponse.json({ error: "Choose a valid table, date and time." }, { status: 400 });
  const durationMinutes = (endsAt.getTime() - startsAt.getTime()) / 60000;
  if (startsAt.getTime() < Date.now() - 5 * 60000 || durationMinutes < 30 || durationMinutes > 360) return NextResponse.json({ error: "Bookings must be between 30 minutes and 6 hours and cannot start in the past." }, { status: 400 });
  if (startsAt.getTime() > Date.now() + 60 * 24 * 60 * 60 * 1000) return NextResponse.json({ error: "Bookings can be made up to 60 days ahead." }, { status: 400 });
  const startInLondon = londonDateParts(startsAt);
  const tableResult = await auth.client.from("cue_tables").select("id,sport_type,is_active").eq("id", tableId).maybeSingle();
  if (!tableResult.data?.is_active) return NextResponse.json({ error: "That table is not available." }, { status: 404 });
  const maximumMinutes = tableResult.data.sport_type === "pool" ? 30 : 60;
  if (!auth.isSuper && durationMinutes !== maximumMinutes) return NextResponse.json({ error: `${tableResult.data.sport_type === "pool" ? "Pool" : "Snooker"} table bookings must be ${maximumMinutes}-minute sessions.` }, { status: 400 });
  if (!auth.isSuper && startInLondon.minutes % 30 !== 0) return NextResponse.json({ error: "Table bookings must start on the hour or half hour." }, { status: 400 });
  const { eligibleSports, canBookOther } = await eligibility(auth);
  if (!eligibleSports.includes(tableResult.data.sport_type)) return NextResponse.json({ error: `You do not currently have ${tableResult.data.sport_type} table booking access.` }, { status: 403 });
  if (purpose === "other" && !canBookOther) return NextResponse.json({ error: "Other bookings are limited to team captains, vice-captains and the Super User." }, { status: 403 });
  if (purpose === "fixture") {
    const competitionResult = await auth.client.from("competitions").select("id,name,sport_type,is_archived,is_completed").eq("id", competitionId).maybeSingle();
    if (competitionResult.error) return NextResponse.json({ error: competitionResult.error.message }, { status: 400 });
    const competition = competitionResult.data;
    if (!competition || competition.is_archived || competition.is_completed) return NextResponse.json({ error: "That competition is no longer available for table bookings." }, { status: 409 });
    const competitionSport = competition.sport_type === "snooker" ? "snooker" : "pool";
    if (competitionSport !== tableResult.data.sport_type) return NextResponse.json({ error: `Choose the ${competitionSport} table for this competition.` }, { status: 400 });
    const entrantsResult = await auth.client
      .from("competition_entries")
      .select("player_id,players(id,display_name,full_name)")
      .eq("competition_id", competitionId)
      .eq("status", "approved")
      .in("player_id", [participantOnePlayerId, participantTwoPlayerId]);
    if (entrantsResult.error) return NextResponse.json({ error: entrantsResult.error.message }, { status: 400 });
    if ((entrantsResult.data ?? []).length !== 2) return NextResponse.json({ error: "Both selected players must be approved entrants in that competition." }, { status: 400 });
    if (!auth.isSuper && ![participantOnePlayerId, participantTwoPlayerId].includes(auth.playerId ?? "")) {
      return NextResponse.json({ error: "One of the selected players must be your linked player profile." }, { status: 403 });
    }
    const entrantNames = new Map((entrantsResult.data ?? []).map((entry) => {
      const player = entry.players as unknown as { display_name: string; full_name: string | null } | null;
      return [entry.player_id, player?.full_name?.trim() || player?.display_name || "Player"];
    }));
    participantOne = entrantNames.get(participantOnePlayerId) ?? null;
    participantTwo = entrantNames.get(participantTwoPlayerId) ?? null;
  }
  const endInLondon = londonDateParts(endsAt);
  const effectiveHours = await effectiveBookingHours(auth.client, tableId, startInLondon.date, startInLondon.weekday).catch((error: Error) => ({ error }));
  if (effectiveHours && "error" in effectiveHours) return NextResponse.json({ error: effectiveHours.error.message }, { status: 400 });
  const withinHours = effectiveHours && startInLondon.date === endInLondon.date && startInLondon.minutes >= timeMinutes(effectiveHours.opens_at) && endInLondon.minutes <= timeMinutes(effectiveHours.closes_at);
  if (!withinHours) {
    const hours = effectiveHours ? `${effectiveHours.opens_at.slice(0, 5)}–${effectiveHours.closes_at.slice(0, 5)}` : "closed";
    return NextResponse.json({ error: `This table is not available for that whole period. Its booking hours on ${startInLondon.date} are ${hours}.` }, { status: 409 });
  }
  const blockResult = await auth.client.from("table_booking_blocks").select("title").or(`table_id.is.null,table_id.eq.${tableId}`).lt("starts_at", endsAt.toISOString()).gt("ends_at", startsAt.toISOString()).limit(1).maybeSingle();
  if (blockResult.error) return NextResponse.json({ error: blockResult.error.message }, { status: 400 });
  if (blockResult.data) return NextResponse.json({ error: `This table is unavailable then: ${blockResult.data.title}.` }, { status: 409 });
  let bookedConflictQuery = auth.client.from("table_reservations").select("id", { count: "exact", head: true }).eq("table_id", tableId).eq("status", "booked").lt("starts_at", endsAt.toISOString()).gt("ends_at", startsAt.toISOString());
  if (editingReservationId) bookedConflictQuery = bookedConflictQuery.neq("id", editingReservationId);
  const bookedConflict = await bookedConflictQuery;
  if (bookedConflict.error) return NextResponse.json({ error: bookedConflict.error.message }, { status: 400 });
  if ((bookedConflict.count ?? 0) > 0) return NextResponse.json({ error: "That table is already booked during this time." }, { status: 409 });
  const autoApproved = purpose === "fixture";
  const status = auth.isSuper || autoApproved ? "booked" : "pending";
  const reviewedAt = status === "booked" ? new Date().toISOString() : null;
  const reviewedByUserId = auth.isSuper ? auth.user.id : null;
  const bookedForPlayerId = purpose === "fixture" ? participantOnePlayerId : auth.playerId;
  if (!bookedForPlayerId) return NextResponse.json({ error: "Choose a competition fixture with two players, or link the Super User account to a player profile first." }, { status: 409 });
  if (editingReservationId) {
    const updateResult = await auth.client.from("table_reservations").update({ table_id: tableId, booked_for_player_id: bookedForPlayerId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), purpose, notes: purpose === "other" ? otherReason : null, participant_one: participantOne, participant_two: participantTwo, team_name: teamName, competition_id: competitionId, participant_one_player_id: participantOnePlayerId, participant_two_player_id: participantTwoPlayerId, status, rejection_reason: null, reviewed_at: reviewedAt, reviewed_by_user_id: reviewedByUserId, cancelled_at: null, cancelled_by_user_id: null }).eq("id", editingReservationId);
    if (updateResult.error) {
      if (updateResult.error.code === "23P01") return NextResponse.json({ error: "That table is already reserved during this time." }, { status: 409 });
      return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    }
    await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: auth.isSuper ? "table_reservation_edited" : "table_booking_edit_requested", entity_type: "table_reservation", entity_id: editingReservationId, summary: `${auth.isSuper ? "Cue table reservation edited" : "Cue table booking edit submitted for approval"}: ${startsAt.toISOString()} to ${endsAt.toISOString()}.`, meta: { table_id: tableId, player_id: auth.playerId, purpose } });
    return NextResponse.json({ ok: true, id: editingReservationId, status, autoApproved });
  }
  const insertResult = await auth.client.from("table_reservations").insert({ table_id: tableId, booked_by_user_id: auth.user.id, booked_for_player_id: bookedForPlayerId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), purpose, notes: purpose === "other" ? otherReason : null, participant_one: participantOne, participant_two: participantTwo, team_name: teamName, competition_id: competitionId, participant_one_player_id: participantOnePlayerId, participant_two_player_id: participantTwoPlayerId, requester_email: auth.user.email ?? null, status, reviewed_at: reviewedAt, reviewed_by_user_id: reviewedByUserId }).select("id").single();
  if (insertResult.error) {
    if (insertResult.error.code === "23P01") return NextResponse.json({ error: "That table is already reserved during this time." }, { status: 409 });
    return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
  }
  await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: status === "booked" ? "table_reserved" : "table_booking_requested", entity_type: "table_reservation", entity_id: insertResult.data.id, summary: `${status === "booked" ? "Cue table reserved" : "Cue table booking requested"} from ${startsAt.toISOString()} to ${endsAt.toISOString()}.`, meta: { table_id: tableId, player_id: auth.playerId, competition_id: competitionId, participant_player_ids: [participantOnePlayerId, participantTwoPlayerId].filter(Boolean), purpose, auto_approved: autoApproved } });
  if (autoApproved && participantOnePlayerId && participantTwoPlayerId) {
    const participantUsers = await auth.client.from("app_users").select("id").in("linked_player_id", [participantOnePlayerId, participantTwoPlayerId]);
    await sendPushToUserIds(auth.client, (participantUsers.data ?? []).map((user) => user.id), {
      title: "Competition table booked",
      body: `${bookingTitle({ purpose, participant_one: participantOne, participant_two: participantTwo })} · ${londonBookingTime(startsAt.toISOString(), endsAt.toISOString())}`,
      url: "/table-bookings#confirmed-bookings",
      tag: `table-booking-confirmed-${insertResult.data.id}`,
    });
  } else if (!auth.isSuper) {
    const managersResult = await auth.client.from("app_users").select("id").in("role", ["owner", "super"]);
    await sendPushToUserIds(auth.client, (managersResult.data ?? []).map((manager) => manager.id), {
      title: "New table-booking request",
      body: `${bookingTitle({ purpose, participant_one: participantOne, participant_two: participantTwo, team_name: teamName, notes: otherReason })} · ${londonBookingTime(startsAt.toISOString(), endsAt.toISOString())}`,
      url: "/table-bookings",
      tag: `table-booking-request-${insertResult.data.id}`,
    });
  }
  return NextResponse.json({ ok: true, id: insertResult.data.id, status, autoApproved });
}
