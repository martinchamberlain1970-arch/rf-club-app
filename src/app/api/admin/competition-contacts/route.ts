import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();

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
  return { client, user, role, linkedPlayerId: appUserResult.data?.linked_player_id as string | null };
}

async function canManageCompetition(client: SupabaseClient, competitionId: string, auth: NonNullable<Awaited<ReturnType<typeof authorize>>>) {
  if (Boolean(superAdminEmail && auth.user.email?.toLowerCase() === superAdminEmail) || auth.role === "owner") return true;
  if (auth.role !== "admin" || !auth.linkedPlayerId) return false;
  const [competitionResult, playerResult] = await Promise.all([
    client.from("competitions").select("location_id").eq("id", competitionId).maybeSingle(),
    client.from("players").select("location_id").eq("id", auth.linkedPlayerId).maybeSingle(),
  ]);
  return Boolean(competitionResult.data?.location_id && competitionResult.data.location_id === playerResult.data?.location_id);
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const competitionId = request.nextUrl.searchParams.get("competitionId") ?? "";
  if (!competitionId || !(await canManageCompetition(auth.client, competitionId, auth))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const entriesResult = await auth.client
    .from("competition_entries")
    .select("id,player_id,public_signup_id")
    .eq("competition_id", competitionId)
    .eq("status", "approved");
  if (entriesResult.error) return NextResponse.json({ error: entriesResult.error.message }, { status: 400 });
  const entries = entriesResult.data ?? [];
  const playerIds = entries.map((entry) => entry.player_id);
  const signupIds = entries.map((entry) => entry.public_signup_id).filter(Boolean) as string[];
  const [playersResult, usersResult, signupsResult, savedResult] = await Promise.all([
    auth.client.from("players").select("id,display_name,full_name").in("id", playerIds),
    auth.client.from("app_users").select("linked_player_id,email").in("linked_player_id", playerIds),
    signupIds.length ? auth.client.from("public_competition_signups").select("id,email,phone,fixture_access_token").in("id", signupIds) : Promise.resolve({ data: [], error: null }),
    auth.client.from("competition_entry_contacts").select("competition_entry_id,email,phone").in("competition_entry_id", entries.map((entry) => entry.id)),
  ]);
  const error = playersResult.error || usersResult.error || signupsResult.error || savedResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const players = new Map((playersResult.data ?? []).map((row) => [row.id, row]));
  const userEmails = new Map((usersResult.data ?? []).map((row) => [row.linked_player_id, row.email]));
  const signups = new Map((signupsResult.data ?? []).map((row) => [row.id, row]));
  const saved = new Map((savedResult.data ?? []).map((row) => [row.competition_entry_id, row]));
  return NextResponse.json({ contacts: entries.map((entry) => {
    const player = players.get(entry.player_id);
    const signup = signups.get(entry.public_signup_id ?? "");
    const override = saved.get(entry.id);
    return {
      entryId: entry.id,
      playerId: entry.player_id,
      name: player?.full_name?.trim() || player?.display_name || "Unknown player",
      email: override?.email || signup?.email || userEmails.get(entry.player_id) || null,
      phone: override?.phone || signup?.phone || null,
      fixtureAccessToken: signup?.fixture_access_token || null,
    };
  }) });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const entryId = String(body?.entryId ?? "");
  const email = String(body?.email ?? "").trim().toLowerCase();
  const phone = String(body?.phone ?? "").trim().replace(/[^\d+()\s-]/g, "");
  if (!entryId || (!email && !phone)) return NextResponse.json({ error: "Enter an email address or phone number." }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (phone && phone.replace(/\D/g, "").length < 7) return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });
  const entryResult = await auth.client.from("competition_entries").select("competition_id").eq("id", entryId).maybeSingle();
  if (!entryResult.data || !(await canManageCompetition(auth.client, entryResult.data.competition_id, auth))) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const saveResult = await auth.client.from("competition_entry_contacts").upsert({ competition_entry_id: entryId, email: email || null, phone: phone || null, updated_at: new Date().toISOString() });
  if (saveResult.error) return NextResponse.json({ error: saveResult.error.message }, { status: 400 });
  return NextResponse.json({ ok: true, email: email || null, phone: phone || null });
}
