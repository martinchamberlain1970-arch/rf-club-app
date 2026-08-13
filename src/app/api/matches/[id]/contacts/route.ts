import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await context.params;
  const matchResult = await client
    .from("matches")
    .select("id,competition_id,player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id")
    .eq("id", id)
    .maybeSingle();
  const match = matchResult.data;
  if (!match) return NextResponse.json({ error: "Fixture not found." }, { status: 404 });
  const participantIds = [...new Set([
    match.player1_id, match.player2_id, match.team1_player1_id, match.team1_player2_id, match.team2_player1_id, match.team2_player2_id,
  ].filter(Boolean) as string[])];

  const viewerResult = await client.from("app_users").select("role,linked_player_id").eq("id", user.id).maybeSingle();
  const role = String(viewerResult.data?.role ?? "").toLowerCase();
  const isSuper = Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail) || role === "owner";
  let isClubManager = false;
  if (!isSuper && role === "admin" && viewerResult.data?.linked_player_id) {
    const [competitionResult, managerPlayerResult] = await Promise.all([
      client.from("competitions").select("location_id").eq("id", match.competition_id).maybeSingle(),
      client.from("players").select("location_id").eq("id", viewerResult.data.linked_player_id).maybeSingle(),
    ]);
    isClubManager = Boolean(
      competitionResult.data?.location_id && competitionResult.data.location_id === managerPlayerResult.data?.location_id
    );
  }
  const isManager = isSuper || isClubManager;
  const isParticipant = Boolean(viewerResult.data?.linked_player_id && participantIds.includes(viewerResult.data.linked_player_id));
  if (!isManager && !isParticipant) return NextResponse.json({ error: "Contact details are only available to fixture players and competition managers." }, { status: 403 });

  const [playersResult, appUsersResult, entriesResult] = await Promise.all([
    client.from("players").select("id,display_name,full_name").in("id", participantIds),
    client.from("app_users").select("linked_player_id,email").in("linked_player_id", participantIds),
    client.from("competition_entries").select("id,player_id,public_signup_id").eq("competition_id", match.competition_id).in("player_id", participantIds),
  ]);
  if (playersResult.error || appUsersResult.error || entriesResult.error) {
    return NextResponse.json({ error: playersResult.error?.message ?? appUsersResult.error?.message ?? entriesResult.error?.message }, { status: 400 });
  }
  const signupIds = (entriesResult.data ?? []).map((entry) => entry.public_signup_id).filter(Boolean) as string[];
  const [signupResult, savedResult] = await Promise.all([
    signupIds.length
      ? client.from("public_competition_signups").select("id,email,phone").in("id", signupIds)
      : Promise.resolve({ data: [], error: null }),
    client.from("competition_entry_contacts").select("competition_entry_id,email,phone").in("competition_entry_id", (entriesResult.data ?? []).map((entry) => entry.id)),
  ]);
  if (signupResult.error || savedResult.error) return NextResponse.json({ error: signupResult.error?.message ?? savedResult.error?.message }, { status: 400 });

  const appEmailByPlayer = new Map((appUsersResult.data ?? []).map((row) => [row.linked_player_id, row.email]));
  const signupById = new Map((signupResult.data ?? []).map((row) => [row.id, row]));
  const entryByPlayer = new Map((entriesResult.data ?? []).map((row) => [row.player_id, row]));
  const savedByEntry = new Map((savedResult.data ?? []).map((row) => [row.competition_entry_id, row]));
  const contacts = (playersResult.data ?? []).map((player) => {
    const entry = entryByPlayer.get(player.id);
    const signup = signupById.get(entry?.public_signup_id ?? "");
    const saved = savedByEntry.get(entry?.id ?? "");
    return {
      playerId: player.id,
      name: player.full_name?.trim() || player.display_name,
      email: saved?.email || signup?.email || appEmailByPlayer.get(player.id) || null,
      phone: saved?.phone || signup?.phone || null,
    };
  });
  return NextResponse.json({ contacts });
}
