import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const londonDateKey = (value: string | Date) => new Date(value).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Display is not configured." }, { status: 500 });
  const sport = request.nextUrl.searchParams.get("sport");
  if (sport && !["pool", "snooker"].includes(sport)) return NextResponse.json({ error: "Choose pool or snooker." }, { status: 400 });
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const today = londonDateKey(new Date());
  const monday = new Date(`${today}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const nextMonday = new Date(monday); nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  const afterNextSunday = new Date(monday); afterNextSunday.setUTCDate(afterNextSunday.getUTCDate() + 14);
  const weekStart = isoDate(monday);
  const nextWeekStart = isoDate(nextMonday);
  const rangeEnd = isoDate(afterNextSunday);
  const now = new Date();
  const approximateFrom = now.toISOString();
  const approximateTo = new Date(afterNextSunday.getTime() + 24 * 60 * 60 * 1000).toISOString();

  let tablesQuery = client.from("cue_tables").select("id,name,sport_type,display_order").eq("is_active", true).order("display_order");
  if (sport) tablesQuery = tablesQuery.eq("sport_type", sport);
  const tablesResult = await tablesQuery;
  if (tablesResult.error) return NextResponse.json({ error: tablesResult.error.message }, { status: 400 });
  const tableIds = (tablesResult.data ?? []).map((table) => table.id);
  const [reservationsResult, blocksResult, hoursResult] = await Promise.all([
    tableIds.length
      ? client.from("table_reservations").select("id,table_id,booked_for_player_id,starts_at,ends_at,purpose,notes,participant_one,participant_two,team_name").in("table_id", tableIds).eq("status", "booked").gt("ends_at", approximateFrom).lte("starts_at", approximateTo).order("starts_at")
      : Promise.resolve({ data: [], error: null }),
    client.from("table_booking_blocks").select("id,table_id,starts_at,ends_at,category,title,notes").gt("ends_at", approximateFrom).lte("starts_at", approximateTo).order("starts_at"),
    tableIds.length
      ? client.from("table_booking_hours").select("id,table_id,weekday,opens_at,closes_at").in("table_id", tableIds).order("weekday")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error = reservationsResult.error || blocksResult.error || hoursResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const reservations = (reservationsResult.data ?? []).filter((entry) => new Date(entry.ends_at).getTime() > now.getTime() && londonDateKey(entry.starts_at) < rangeEnd && londonDateKey(entry.ends_at) >= weekStart);
  const blocks = (blocksResult.data ?? []).filter((entry) => new Date(entry.ends_at).getTime() > now.getTime() && (!entry.table_id || tableIds.includes(entry.table_id)) && londonDateKey(entry.starts_at) < rangeEnd && londonDateKey(entry.ends_at) >= weekStart);
  const playerIds = [...new Set(reservations.map((reservation) => reservation.booked_for_player_id))];
  const playersResult = playerIds.length ? await client.from("players").select("id,display_name,full_name").in("id", playerIds) : { data: [], error: null };
  if (playersResult.error) return NextResponse.json({ error: playersResult.error.message }, { status: 400 });
  const names = new Map((playersResult.data ?? []).map((player) => [player.id, player.full_name?.trim() || player.display_name]));
  return NextResponse.json({
    sport: sport ?? "all",
    weekStart,
    nextWeekStart,
    rangeEnd,
    tables: tablesResult.data ?? [],
    reservations: reservations.map((reservation) => ({
      ...reservation,
      playerName: reservation.purpose === "league_match"
        ? reservation.team_name || names.get(reservation.booked_for_player_id) || "League booking"
        : reservation.purpose === "other"
          ? reservation.notes || "Other booking"
          : [reservation.participant_one, reservation.participant_two].filter(Boolean).join(" vs. ") || names.get(reservation.booked_for_player_id) || "Competition booking",
    })),
    blocks,
    availability: hoursResult.data ?? [],
    updatedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } });
}
