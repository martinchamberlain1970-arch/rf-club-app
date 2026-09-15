import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { calculateSnookerHandicapStarts } from "@/lib/snooker-handicap";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();

type CompetitionRow = {
  id: string;
  name: string;
  competition_format: string;
  league_schedule_mode: string | null;
  league_meetings: number | null;
  league_start_date: string | null;
  league_break_weeks: string[] | null;
  best_of: number;
  sport_type: "snooker" | "pool_8_ball" | "pool_9_ball";
  handicap_enabled: boolean | null;
  app_assign_opening_break: boolean | null;
};

type MatchRow = {
  id: string;
  round_no: number | null;
  match_no: number | null;
  status: "pending" | "in_progress" | "complete" | "bye";
  player1_id: string | null;
  player2_id: string | null;
  scheduled_for: string | null;
  updated_at: string | null;
};

type PlannedFixture = {
  competition_id: string;
  round_no: number;
  match_no: number;
  best_of: number;
  status: "pending";
  match_mode: "singles";
  player1_id: string;
  player2_id: string;
  winner_player_id: null;
  opening_break_player_id: string | null;
  scheduled_for: string;
  team1_handicap_start: number;
  team2_handicap_start: number;
};

type Plan = {
  competition: CompetitionRow;
  entry: { id: string; player_id: string; status: string; payment_status: string; payment_amount_pence: number | null };
  playerName: string;
  remainingPlayerCount: number;
  archiveIds: string[];
  withdrawnMatchIds: string[];
  withdrawnCompletedMatchIds: string[];
  replaceableMatchIds: string[];
  preservedMatchIds: string[];
  pendingRescheduleIds: string[];
  protectedRescheduleCount: number;
  affectedBookings: Array<{ id: string; starts_at: string; ends_at: string; participant_one: string | null; participant_two: string | null }>;
  fixtures: PlannedFixture[];
  weeks: Array<{ date: string; fixtureCount: number; idlePlayerCount: number }>;
  firstDate: string | null;
  finalDate: string | null;
  previewToken: string;
};

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
  if (Boolean(superAdminEmail && auth.user.email?.toLowerCase() === superAdminEmail) || auth.role === "owner" || auth.role === "super") return true;
  if (auth.role !== "admin" || !auth.linkedPlayerId) return false;
  const [competitionResult, playerResult] = await Promise.all([
    client.from("competitions").select("location_id").eq("id", competitionId).maybeSingle(),
    client.from("players").select("location_id").eq("id", auth.linkedPlayerId).maybeSingle(),
  ]);
  return Boolean(competitionResult.data?.location_id && competitionResult.data.location_id === playerResult.data?.location_id);
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const parseDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00Z`);
const addDays = (value: string, days: number) => {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
};
const mondayOfWeek = (value: string) => {
  const date = parseDate(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return isoDate(date);
};
const pairKey = (a: string, b: string) => [a, b].sort().join(":");
const pairFromKey = (key: string) => key.split(":") as [string, string];

function maximumRound(playerIds: string[], pairCounts: Map<string, number>, blocked: Set<string>) {
  const available = playerIds.filter((id) => !blocked.has(id));
  const degree = (id: string, candidates: string[]) => candidates.reduce((total, opponent) => total + (pairCounts.get(pairKey(id, opponent)) ?? 0), 0);
  let best: Array<[string, string]> = [];

  const search = (remaining: string[], chosen: Array<[string, string]>) => {
    if (chosen.length + Math.floor(remaining.length / 2) <= best.length) return;
    if (remaining.length < 2) {
      if (chosen.length > best.length) best = chosen;
      return;
    }
    const ordered = [...remaining].sort((a, b) => degree(b, remaining) - degree(a, remaining) || a.localeCompare(b));
    const first = ordered[0];
    const rest = ordered.slice(1);
    const opponents = rest
      .filter((opponent) => (pairCounts.get(pairKey(first, opponent)) ?? 0) > 0)
      .sort((a, b) => degree(b, rest) - degree(a, rest) || a.localeCompare(b));
    for (const opponent of opponents) {
      search(rest.filter((id) => id !== opponent), [...chosen, [first, opponent]]);
      if (best.length === Math.floor(available.length / 2)) return;
    }
    search(rest, chosen);
  };

  search(available, []);
  return best;
}

async function buildPlan(client: SupabaseClient, competitionId: string, playerId: string): Promise<Plan> {
  const [competitionResult, entryResult, entriesResult, playersResult, matchesResult] = await Promise.all([
    client.from("competitions").select("id,name,competition_format,league_schedule_mode,league_meetings,league_start_date,league_break_weeks,best_of,sport_type,handicap_enabled,app_assign_opening_break").eq("id", competitionId).maybeSingle(),
    client.from("competition_entries").select("id,player_id,status,payment_status,payment_amount_pence").eq("competition_id", competitionId).eq("player_id", playerId).eq("status", "approved").maybeSingle(),
    client.from("competition_entries").select("player_id").eq("competition_id", competitionId).eq("status", "approved"),
    client.from("players").select("id,display_name,full_name,snooker_handicap").eq("is_archived", false),
    client.from("matches").select("id,round_no,match_no,status,player1_id,player2_id,scheduled_for,updated_at").eq("competition_id", competitionId).eq("is_archived", false).order("scheduled_for").order("round_no").order("match_no"),
  ]);
  const error = competitionResult.error ?? entryResult.error ?? entriesResult.error ?? playersResult.error ?? matchesResult.error;
  if (error) throw new Error(error.message);
  const competition = competitionResult.data as CompetitionRow | null;
  const entry = entryResult.data as Plan["entry"] | null;
  if (!competition || competition.competition_format !== "league" || competition.league_schedule_mode === "one_day") throw new Error("Withdrawal rebalancing is only available for weekly league competitions.");
  if (!entry) throw new Error("This player does not have an approved entry in the competition.");

  const allPlayerRows = (playersResult.data ?? []) as Array<{ id: string; display_name: string; full_name: string | null; snooker_handicap: number | null }>;
  const playerById = new Map(allPlayerRows.map((player) => [player.id, player]));
  const remainingIds = [...new Set((entriesResult.data ?? []).map((row) => String(row.player_id)).filter((id) => id !== playerId))].sort();
  if (remainingIds.length < 2) throw new Error("At least two players must remain in the competition.");
  const remainingSet = new Set(remainingIds);
  const playerName = playerById.get(playerId)?.full_name?.trim() || playerById.get(playerId)?.display_name || "Selected player";
  const matches = (matchesResult.data ?? []) as MatchRow[];
  const matchIds = matches.map((match) => match.id);
  const [submissionsResult, reschedulesResult, bookingsResult] = await Promise.all([
    matchIds.length ? client.from("result_submissions").select("id,match_id,status").in("match_id", matchIds) : Promise.resolve({ data: [], error: null }),
    matchIds.length ? client.from("league_reschedule_requests").select("id,match_id,status,requested_scheduled_for").in("match_id", matchIds) : Promise.resolve({ data: [], error: null }),
    client.from("table_reservations").select("id,starts_at,ends_at,status,participant_one,participant_two,participant_one_player_id,participant_two_player_id").eq("competition_id", competitionId).eq("status", "booked").gte("ends_at", new Date().toISOString()),
  ]);
  const relatedError = submissionsResult.error ?? reschedulesResult.error ?? bookingsResult.error;
  if (relatedError) throw new Error(relatedError.message);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const currentWeekEnd = addDays(mondayOfWeek(today), 6);
  const submittedMatchIds = new Set((submissionsResult.data ?? []).map((row) => String(row.match_id)));
  const approvedRescheduledMatchIds = new Set((reschedulesResult.data ?? []).filter((row) => row.status === "approved").map((row) => String(row.match_id)));
  const bookings = (bookingsResult.data ?? []) as Array<{ id: string; starts_at: string; ends_at: string; participant_one: string | null; participant_two: string | null; participant_one_player_id: string | null; participant_two_player_id: string | null }>;
  const bookedPairs = new Set(bookings
    .filter((booking) => booking.participant_one_player_id && booking.participant_two_player_id)
    .map((booking) => pairKey(String(booking.participant_one_player_id), String(booking.participant_two_player_id))));

  const withdrawnMatches = matches.filter((match) => match.player1_id === playerId || match.player2_id === playerId);
  const locked = matches.filter((match) => {
    if (!match.player1_id || !match.player2_id || match.player1_id === match.player2_id || match.status === "bye") return false;
    if (!remainingSet.has(match.player1_id) || !remainingSet.has(match.player2_id)) return false;
    return match.status !== "pending"
      || Boolean(match.scheduled_for && match.scheduled_for.slice(0, 10) <= currentWeekEnd)
      || submittedMatchIds.has(match.id)
      || approvedRescheduledMatchIds.has(match.id)
      || bookedPairs.has(pairKey(match.player1_id, match.player2_id));
  });
  const lockedIds = new Set(locked.map((match) => match.id));
  const archiveIds = matches.filter((match) => !lockedIds.has(match.id)).map((match) => match.id);
  const archiveIdSet = new Set(archiveIds);
  const pendingRescheduleIds = (reschedulesResult.data ?? [])
    .filter((row) => row.status === "pending" && archiveIdSet.has(String(row.match_id)))
    .map((row) => String(row.id));
  const meetings = Math.max(1, Number(competition.league_meetings ?? 2));
  const remainingCounts = new Map<string, number>();
  for (let i = 0; i < remainingIds.length; i += 1) {
    for (let j = i + 1; j < remainingIds.length; j += 1) remainingCounts.set(pairKey(remainingIds[i], remainingIds[j]), meetings);
  }
  for (const match of locked) {
    const key = pairKey(match.player1_id as string, match.player2_id as string);
    const next = (remainingCounts.get(key) ?? 0) - 1;
    if (next < 0) throw new Error("Existing fixtures already exceed the configured number of meetings for at least one pairing.");
    remainingCounts.set(key, next);
  }

  const lockedByWeek = new Map<string, Set<string>>();
  for (const match of locked) {
    if (!match.scheduled_for || match.scheduled_for.slice(0, 10) <= currentWeekEnd) continue;
    const week = mondayOfWeek(match.scheduled_for);
    const set = lockedByWeek.get(week) ?? new Set<string>();
    if (match.player1_id) set.add(match.player1_id);
    if (match.player2_id) set.add(match.player2_id);
    lockedByWeek.set(week, set);
  }

  const breakWeeks = new Set((competition.league_break_weeks ?? []).map((date) => mondayOfWeek(String(date))));
  let cursor = addDays(mondayOfWeek(today), 7);
  let roundsTried = 0;
  const rawWeeks: Array<{ date: string; pairs: Array<[string, string]> }> = [];
  const remainingTotal = () => [...remainingCounts.values()].reduce((sum, value) => sum + value, 0);
  while (remainingTotal() > 0) {
    if (roundsTried++ > 80) throw new Error("The remaining fixtures could not be fitted into a safe weekly schedule.");
    if (breakWeeks.has(cursor)) {
      cursor = addDays(cursor, 7);
      continue;
    }
    const pairs = maximumRound(remainingIds, remainingCounts, lockedByWeek.get(cursor) ?? new Set());
    if (pairs.length) {
      rawWeeks.push({ date: cursor, pairs });
      for (const [a, b] of pairs) {
        const key = pairKey(a, b);
        remainingCounts.set(key, (remainingCounts.get(key) ?? 1) - 1);
      }
    }
    cursor = addDays(cursor, 7);
  }

  const historicalRoundMax = matches
    .filter((match) => match.scheduled_for && match.scheduled_for.slice(0, 10) <= currentWeekEnd)
    .reduce((max, match) => Math.max(max, match.round_no ?? 0), 0);
  const occurrenceByPair = new Map<string, number>();
  for (const match of locked) {
    if (!match.player1_id || !match.player2_id) continue;
    const key = pairKey(match.player1_id, match.player2_id);
    occurrenceByPair.set(key, (occurrenceByPair.get(key) ?? 0) + 1);
  }
  const handicapById = new Map(allPlayerRows.map((player) => [player.id, player.snooker_handicap ?? 0]));
  const fixtures: PlannedFixture[] = [];
  rawWeeks.forEach((week, weekIndex) => {
    const existingThatWeek = locked.filter((match) => match.scheduled_for && mondayOfWeek(match.scheduled_for) === week.date).length;
    week.pairs.forEach(([a, b], matchIndex) => {
      const key = pairKey(a, b);
      const occurrence = (occurrenceByPair.get(key) ?? 0) + 1;
      occurrenceByPair.set(key, occurrence);
      const [first] = pairFromKey(key);
      const openingBreak = competition.app_assign_opening_break ? (occurrence % 2 === 1 ? first : first === a ? b : a) : null;
      const handicap = competition.handicap_enabled && competition.sport_type === "snooker"
        ? calculateSnookerHandicapStarts(handicapById.get(a), handicapById.get(b))
        : { team1: 0, team2: 0 };
      fixtures.push({
        competition_id: competitionId,
        round_no: historicalRoundMax + weekIndex + 1,
        match_no: existingThatWeek + matchIndex + 1,
        best_of: competition.best_of,
        status: "pending",
        match_mode: "singles",
        player1_id: a,
        player2_id: b,
        winner_player_id: null,
        opening_break_player_id: openingBreak,
        scheduled_for: week.date,
        team1_handicap_start: handicap.team1,
        team2_handicap_start: handicap.team2,
      });
    });
  });

  const tokenSource = JSON.stringify({
    competitionId,
    playerId,
    entry: entry.id,
    matches: matches.map((match) => [match.id, match.status, match.scheduled_for, match.updated_at]),
    fixtures: fixtures.map((fixture) => [fixture.player1_id, fixture.player2_id, fixture.scheduled_for]),
  });
  const previewToken = createHash("sha256").update(tokenSource).digest("hex");
  return {
    competition,
    entry,
    playerName,
    remainingPlayerCount: remainingIds.length,
    archiveIds,
    withdrawnMatchIds: withdrawnMatches.map((match) => match.id),
    withdrawnCompletedMatchIds: withdrawnMatches.filter((match) => match.status === "complete").map((match) => match.id),
    replaceableMatchIds: archiveIds.filter((id) => !withdrawnMatches.some((match) => match.id === id)),
    preservedMatchIds: locked.map((match) => match.id),
    pendingRescheduleIds,
    protectedRescheduleCount: [...approvedRescheduledMatchIds].filter((matchId) => lockedIds.has(matchId)).length,
    affectedBookings: bookings.filter((booking) => booking.participant_one_player_id === playerId || booking.participant_two_player_id === playerId).map(({ id, starts_at, ends_at, participant_one, participant_two }) => ({ id, starts_at, ends_at, participant_one, participant_two })),
    fixtures,
    weeks: rawWeeks.map((week) => ({ date: week.date, fixtureCount: week.pairs.length, idlePlayerCount: Math.max(0, remainingIds.length - (week.pairs.length * 2) - (lockedByWeek.get(week.date)?.size ?? 0)) })),
    firstDate: rawWeeks[0]?.date ?? null,
    finalDate: rawWeeks.at(-1)?.date ?? null,
    previewToken,
  };
}

function publicPlan(plan: Plan) {
  return {
    previewToken: plan.previewToken,
    competitionName: plan.competition.name,
    sportType: plan.competition.sport_type,
    playerName: plan.playerName,
    remainingPlayerCount: plan.remainingPlayerCount,
    paidAmountPence: plan.entry.payment_amount_pence,
    paymentStatus: plan.entry.payment_status,
    completedResultsAnnulled: plan.withdrawnCompletedMatchIds.length,
    withdrawnFixturesArchived: plan.withdrawnMatchIds.length,
    existingFixturesPreserved: plan.preservedMatchIds.length,
    futureFixturesReplaced: plan.replaceableMatchIds.length,
    newFixtures: plan.fixtures.length,
    playingWeeks: plan.weeks.length,
    partialWeeks: plan.weeks.filter((week) => week.idlePlayerCount > 0).length,
    firstDate: plan.firstDate,
    finalDate: plan.finalDate,
    protectedReschedules: plan.protectedRescheduleCount,
    pendingReschedulesClosed: plan.pendingRescheduleIds.length,
    affectedBookings: plan.affectedBookings,
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const competitionId = request.nextUrl.searchParams.get("competitionId") ?? "";
  const playerId = request.nextUrl.searchParams.get("playerId") ?? "";
  if (!competitionId || !playerId) return NextResponse.json({ error: "Competition and player are required." }, { status: 400 });
  if (!(await canManage(auth.client, competitionId, auth))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    return NextResponse.json(publicPlan(await buildPlan(auth.client, competitionId, playerId)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "A safe withdrawal plan could not be created." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const competitionId = String(body?.competitionId ?? "");
  const playerId = String(body?.playerId ?? "");
  const previewToken = String(body?.previewToken ?? "");
  if (!competitionId || !playerId || !previewToken) return NextResponse.json({ error: "Confirmed preview details are required." }, { status: 400 });
  if (!(await canManage(auth.client, competitionId, auth))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  let plan: Plan;
  try {
    plan = await buildPlan(auth.client, competitionId, playerId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The withdrawal plan could not be refreshed." }, { status: 400 });
  }
  if (plan.previewToken !== previewToken) return NextResponse.json({ error: "Fixtures changed after the preview. Review the refreshed plan before confirming." }, { status: 409 });

  let insertedIds: string[] = [];
  const rollback = async () => {
    if (insertedIds.length) await auth.client.from("matches").delete().in("id", insertedIds);
    if (plan.archiveIds.length) await auth.client.from("matches").update({ is_archived: false }).in("id", plan.archiveIds);
    await auth.client.from("competition_entries").update({ status: "approved" }).eq("id", plan.entry.id);
  };

  if (plan.archiveIds.length) {
    const archiveResult = await auth.client.from("matches").update({ is_archived: true }).in("id", plan.archiveIds);
    if (archiveResult.error) return NextResponse.json({ error: archiveResult.error.message }, { status: 400 });
  }
  if (plan.fixtures.length) {
    const insertResult = await auth.client.from("matches").insert(plan.fixtures).select("id");
    if (insertResult.error) {
      await rollback();
      return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
    }
    insertedIds = (insertResult.data ?? []).map((row) => String(row.id));
  }
  const entryResult = await auth.client.from("competition_entries").update({ status: "withdrawn", reviewed_by_user_id: auth.user.id, reviewed_at: new Date().toISOString() }).eq("id", plan.entry.id);
  if (entryResult.error) {
    await rollback();
    return NextResponse.json({ error: entryResult.error.message }, { status: 400 });
  }
  if (plan.pendingRescheduleIds.length) {
    await auth.client.from("league_reschedule_requests").update({
      status: "rejected",
      reviewed_by_user_id: auth.user.id,
      reviewed_at: new Date().toISOString(),
      note: "Closed because an entrant withdrew and the remaining fixture calendar was rebalanced.",
    }).in("id", plan.pendingRescheduleIds);
  }
  await auth.client.from("audit_logs").insert({
    actor_user_id: auth.user.id,
    actor_email: auth.user.email ?? null,
    actor_role: auth.role,
    action: "competition_entrant_withdrawn_and_rebalanced",
    entity_type: "competition_entry",
    entity_id: plan.entry.id,
    summary: `${plan.playerName} withdrawn; completed result(s) annulled and remaining league fixtures rebalanced.`,
    meta: {
      competition_id: competitionId,
      player_id: playerId,
      archived_match_ids: plan.archiveIds,
      annulled_completed_match_ids: plan.withdrawnCompletedMatchIds,
      inserted_match_ids: insertedIds,
      preserved_match_ids: plan.preservedMatchIds,
      affected_booking_ids: plan.affectedBookings.map((booking) => booking.id),
      first_new_fixture_date: plan.firstDate,
      final_new_fixture_date: plan.finalDate,
    },
  });
  return NextResponse.json({ ok: true, ...publicPlan(plan) });
}
