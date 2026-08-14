import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();

type MatchRow = { id: string; round_no: number | null; status: string; scheduled_for: string | null };

async function authorize(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return null;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return null;
  const appUserResult = await client.from("app_users").select("role,linked_player_id").eq("id", user.id).maybeSingle();
  return {
    client,
    user,
    role: String(appUserResult.data?.role ?? "").toLowerCase(),
    linkedPlayerId: appUserResult.data?.linked_player_id as string | null,
  };
}

async function canManage(client: SupabaseClient, competitionId: string, auth: NonNullable<Awaited<ReturnType<typeof authorize>>>) {
  if (Boolean(superAdminEmail && auth.user.email?.toLowerCase() === superAdminEmail) || auth.role === "owner") return true;
  if (auth.role !== "admin" || !auth.linkedPlayerId) return false;
  const [competitionResult, playerResult] = await Promise.all([
    client.from("competitions").select("location_id").eq("id", competitionId).maybeSingle(),
    client.from("players").select("location_id").eq("id", auth.linkedPlayerId).maybeSingle(),
  ]);
  return Boolean(competitionResult.data?.location_id && competitionResult.data.location_id === playerResult.data?.location_id);
}

const parseIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};
const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (value: string, days: number) => {
  const date = parseIsoDate(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
};
const mondayOfWeek = (value: string) => {
  const date = parseIsoDate(value);
  if (!date) return null;
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return toIsoDate(date);
};
const nextMondayAfter = (value: string) => {
  const date = parseIsoDate(value) as Date;
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 1 ? 7 : (8 - day) % 7));
  return toIsoDate(date);
};

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const competitionId = String(body?.competitionId ?? "");
  const requestedBreaks = Array.isArray(body?.breakWeeks) ? body.breakWeeks.map(String) : [];
  if (!competitionId || requestedBreaks.length > 20) return NextResponse.json({ error: "Invalid break-week request." }, { status: 400 });
  if (!(await canManage(auth.client, competitionId, auth))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const normalizedBreaks = [...new Set(requestedBreaks.map(mondayOfWeek).filter(Boolean) as string[])].sort();
  if (normalizedBreaks.length !== requestedBreaks.length) return NextResponse.json({ error: "Each break week must be a unique valid date." }, { status: 400 });

  const competitionResult = await auth.client
    .from("competitions")
    .select("id,competition_format,league_schedule_mode,league_start_date")
    .eq("id", competitionId)
    .maybeSingle();
  const competition = competitionResult.data;
  if (!competition || competition.competition_format !== "league" || competition.league_schedule_mode === "one_day" || !competition.league_start_date) {
    return NextResponse.json({ error: "Break weeks are only available for scheduled weekly leagues." }, { status: 400 });
  }

  const matchesResult = await auth.client
    .from("matches")
    .select("id,round_no,status,scheduled_for")
    .eq("competition_id", competitionId)
    .eq("is_archived", false)
    .order("round_no");
  if (matchesResult.error) return NextResponse.json({ error: matchesResult.error.message }, { status: 400 });
  const matches = (matchesResult.data ?? []) as MatchRow[];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const byRound = new Map<number, MatchRow[]>();
  for (const match of matches) {
    const round = match.round_no ?? 1;
    byRound.set(round, [...(byRound.get(round) ?? []), match]);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  let lastLockedRound = 0;
  for (const round of rounds) {
    const roundMatches = byRound.get(round) ?? [];
    const scheduledFor = roundMatches.find((match) => match.scheduled_for)?.scheduled_for ?? null;
    const hasStarted = roundMatches.some((match) => !["pending", "bye"].includes(match.status));
    if (hasStarted || !scheduledFor || scheduledFor <= today) lastLockedRound = Math.max(lastLockedRound, round);
  }
  const mutableRounds = rounds.filter((round) => {
    if (round <= lastLockedRound) return false;
    const roundMatches = byRound.get(round) ?? [];
    return roundMatches.every((match) => ["pending", "bye"].includes(match.status));
  });

  const breakSet = new Set(normalizedBreaks);
  const idealDates = new Map<number, string>();
  let idealCursor = String(competition.league_start_date);
  for (let index = 0; index < rounds.length; index += 1) {
    if (index > 0) idealCursor = addDays(idealCursor, 7);
    while (breakSet.has(mondayOfWeek(idealCursor) ?? "")) idealCursor = addDays(idealCursor, 7);
    idealDates.set(rounds[index], idealCursor);
  }

  const lockedDates = rounds
    .filter((round) => round <= lastLockedRound)
    .flatMap((round) => (byRound.get(round) ?? []).map((match) => match.scheduled_for).filter(Boolean) as string[]);
  const latestLockedDate = lockedDates.sort().at(-1) ?? null;
  let floorDate = latestLockedDate ?? today;
  let nextAvailable = latestLockedDate ? addDays(latestLockedDate, 7) : nextMondayAfter(today);
  if (nextAvailable <= today) nextAvailable = nextMondayAfter(today);
  const updates: Array<{ match: MatchRow; nextDate: string }> = [];
  for (const round of mutableRounds) {
    let nextDate = idealDates.get(round) ?? nextAvailable;
    if (nextDate < nextAvailable) nextDate = nextAvailable;
    while (breakSet.has(mondayOfWeek(nextDate) ?? "")) nextDate = addDays(nextDate, 7);
    for (const match of byRound.get(round) ?? []) {
      if (match.scheduled_for !== nextDate) updates.push({ match, nextDate });
    }
    floorDate = nextDate;
    nextAvailable = addDays(floorDate, 7);
  }

  const applied: Array<{ id: string; oldDate: string | null }> = [];
  for (const update of updates) {
    const result = await auth.client.from("matches").update({ scheduled_for: update.nextDate }).eq("id", update.match.id);
    if (result.error) {
      for (const previous of applied) await auth.client.from("matches").update({ scheduled_for: previous.oldDate }).eq("id", previous.id);
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }
    applied.push({ id: update.match.id, oldDate: update.match.scheduled_for });
  }
  const competitionUpdate = await auth.client.from("competitions").update({ league_break_weeks: normalizedBreaks }).eq("id", competitionId);
  if (competitionUpdate.error) {
    for (const previous of applied) await auth.client.from("matches").update({ scheduled_for: previous.oldDate }).eq("id", previous.id);
    return NextResponse.json({ error: competitionUpdate.error.message }, { status: 400 });
  }
  if (applied.length) {
    await auth.client.from("league_reschedule_requests").update({
      status: "rejected",
      reviewed_by_user_id: auth.user.id,
      reviewed_at: new Date().toISOString(),
      note: "Superseded by an organiser fixture-calendar update.",
    }).in("match_id", applied.map((item) => item.id)).eq("status", "pending");
  }
  await auth.client.from("audit_logs").insert({
    actor_user_id: auth.user.id,
    actor_email: auth.user.email ?? null,
    actor_role: auth.role,
    action: "competition_break_weeks_updated",
    entity_type: "competition",
    entity_id: competitionId,
    summary: `Break weeks updated; ${applied.filter((item) => matches.find((match) => match.id === item.id)?.status !== "bye").length} future fixtures moved.`,
    meta: { break_weeks: normalizedBreaks, moved_match_ids: applied.map((item) => item.id) },
  });
  const movedFixtures = applied.filter((item) => matches.find((match) => match.id === item.id)?.status !== "bye").length;
  return NextResponse.json({ ok: true, breakWeeks: normalizedBreaks, movedFixtures, movedRounds: mutableRounds.length });
}
