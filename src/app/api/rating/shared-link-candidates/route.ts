import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail =
  process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  "";
const sharedRatingApiKey = process.env.SHARED_RATING_API_KEY?.trim() ?? "";
const leagueLinkCandidatesUrl =
  process.env.LEAGUE_SHARED_LINK_CANDIDATES_URL?.trim() ?? "https://rf-league-app.vercel.app/api/rating/export-link-candidates";

export async function GET(req: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }
  if (!sharedRatingApiKey) {
    return NextResponse.json({ error: "Shared rating API key is not configured." }, { status: 500 });
  }

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const authRes = await authClient.auth.getUser(token);
  const user = authRes.data.user;
  if (authRes.error || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const requesterEmail = user.email?.trim().toLowerCase() ?? "";
  if (!superAdminEmail || requesterEmail !== superAdminEmail) {
    return NextResponse.json({ error: "Super User only." }, { status: 403 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const [playersRes, appUsersRes, locationsRes] = await Promise.all([
    adminClient
      .from("players")
      .select("id,display_name,full_name,location_id,is_archived,claimed_by")
      .eq("is_archived", false)
      .order("full_name"),
    adminClient.from("app_users").select("id,email,linked_player_id"),
    adminClient.from("locations").select("id,name"),
  ]);
  if (playersRes.error || appUsersRes.error || locationsRes.error) {
    return NextResponse.json(
      { error: playersRes.error?.message ?? appUsersRes.error?.message ?? locationsRes.error?.message ?? "Failed to load club players." },
      { status: 400 }
    );
  }

  const leagueRes = await fetch(leagueLinkCandidatesUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shared-rating-key": sharedRatingApiKey,
    },
    body: JSON.stringify({ source_app: "club" }),
  });
  const leaguePayload = (await leagueRes.json().catch(() => ({}))) as {
    error?: string;
    players?: unknown[];
    links?: unknown[];
  };
  if (!leagueRes.ok) {
    return NextResponse.json({ error: leaguePayload.error ?? "Failed to load league player candidates." }, { status: 400 });
  }

  const locationById = new Map(((locationsRes.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
  const linkedEmailByPlayerId = new Map(
    ((appUsersRes.data ?? []) as Array<{ email: string | null; linked_player_id: string | null }>)
      .filter((row) => row.linked_player_id && row.email)
      .map((row) => [row.linked_player_id as string, row.email as string])
  );

  return NextResponse.json({
    ok: true,
    clubPlayers: ((playersRes.data ?? []) as Array<{
      id: string;
      display_name: string;
      full_name: string | null;
      location_id: string | null;
      claimed_by: string | null;
    }>).map((player) => ({
      id: player.id,
      display_name: player.display_name,
      full_name: player.full_name,
      location_id: player.location_id,
      location_name: player.location_id ? locationById.get(player.location_id) ?? null : null,
      linked_email: linkedEmailByPlayerId.get(player.id) ?? null,
    })),
    leaguePlayers: leaguePayload.players ?? [],
    existingLinks: leaguePayload.links ?? [],
  });
}
