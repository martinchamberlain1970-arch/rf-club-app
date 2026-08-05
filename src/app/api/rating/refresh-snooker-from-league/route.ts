import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sharedRatingApiKey = process.env.SHARED_RATING_API_KEY?.trim() ?? "";
const leagueSharedRatingExportUrl =
  process.env.LEAGUE_SHARED_RATING_EXPORT_URL?.trim() ?? "https://rf-league-app.vercel.app/api/rating/export-snooker-ratings";

type LeagueRatingRow = {
  source_player_id: string;
  league_player_id: string;
  rating_snooker: number | null;
  peak_rating_snooker: number | null;
  rated_matches_snooker: number | null;
  snooker_handicap: number | null;
  snooker_handicap_base: number | null;
};

export async function POST(req: NextRequest) {
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

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const playersRes = await adminClient
    .from("players")
    .select("id,rating_snooker,peak_rating_snooker,rated_matches_snooker,snooker_handicap,snooker_handicap_base")
    .eq("is_archived", false);
  if (playersRes.error) {
    return NextResponse.json({ error: playersRes.error.message }, { status: 400 });
  }
  const clubPlayers = (playersRes.data ?? []) as Array<{
    id: string;
    rating_snooker: number | null;
    peak_rating_snooker: number | null;
    rated_matches_snooker: number | null;
    snooker_handicap: number | null;
    snooker_handicap_base: number | null;
  }>;
  const sourcePlayerIds = clubPlayers.map((player) => player.id);
  const clubPlayerById = new Map(clubPlayers.map((player) => [player.id, player]));

  const leagueRes = await fetch(leagueSharedRatingExportUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shared-rating-key": sharedRatingApiKey,
    },
    body: JSON.stringify({
      source_app: "club",
      source_player_ids: sourcePlayerIds,
    }),
  });
  const leaguePayload = (await leagueRes.json().catch(() => ({}))) as {
    error?: string;
    players?: LeagueRatingRow[];
  };
  if (!leagueRes.ok) {
    return NextResponse.json({ error: leaguePayload.error ?? "Failed to load official snooker ratings from league app." }, { status: 400 });
  }

  const rows = leaguePayload.players ?? [];
  let updated = 0;
  for (const row of rows) {
    const current = clubPlayerById.get(row.source_player_id);
    if (
      current &&
      current.rating_snooker === row.rating_snooker &&
      current.peak_rating_snooker === row.peak_rating_snooker &&
      current.rated_matches_snooker === row.rated_matches_snooker &&
      current.snooker_handicap === row.snooker_handicap &&
      current.snooker_handicap_base === row.snooker_handicap_base
    ) {
      continue;
    }
    const upd = await adminClient
      .from("players")
      .update({
        rating_snooker: row.rating_snooker,
        peak_rating_snooker: row.peak_rating_snooker,
        rated_matches_snooker: row.rated_matches_snooker,
        snooker_handicap: row.snooker_handicap,
        snooker_handicap_base: row.snooker_handicap_base,
      })
      .eq("id", row.source_player_id);
    if (upd.error) {
      return NextResponse.json({ error: upd.error.message }, { status: 400 });
    }
    updated += 1;
  }

  return NextResponse.json({ ok: true, updated });
}
