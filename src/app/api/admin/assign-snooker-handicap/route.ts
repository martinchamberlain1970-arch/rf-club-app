import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail =
  process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase() ??
  "";

type PlayerRow = {
  id: string;
  display_name: string;
  full_name: string | null;
  rating_snooker: number | null;
  peak_rating_snooker: number | null;
  rated_matches_snooker: number | null;
  snooker_handicap: number | null;
  snooker_handicap_base: number | null;
};

function seedRatingFromHandicap(handicap: number) {
  return Math.round(1000 - handicap * 5);
}

export async function POST(req: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { playerId?: string; handicap?: number } | null;
  const playerId = body?.playerId?.trim();
  const handicap = Number(body?.handicap);

  if (!playerId || !Number.isInteger(handicap)) {
    return NextResponse.json({ error: "Player and handicap are required." }, { status: 400 });
  }

  if (handicap < -80 || handicap > 80 || handicap % 4 !== 0) {
    return NextResponse.json({ error: "Handicap must be a multiple of 4 between -80 and +80." }, { status: 400 });
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const requesterEmail = authData.user.email?.trim().toLowerCase() ?? "";
  if (!superAdminEmail || requesterEmail !== superAdminEmail) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const playerRes = await adminClient
    .from("players")
    .select("id,display_name,full_name,rating_snooker,peak_rating_snooker,rated_matches_snooker,snooker_handicap,snooker_handicap_base")
    .eq("id", playerId)
    .maybeSingle();

  if (playerRes.error) {
    return NextResponse.json({ error: playerRes.error.message }, { status: 400 });
  }

  const player = playerRes.data as PlayerRow | null;
  if (!player) {
    return NextResponse.json({ error: "Player not found." }, { status: 404 });
  }

  if (player.snooker_handicap !== null && player.snooker_handicap !== undefined) {
    return NextResponse.json({ error: "This player already has a snooker handicap." }, { status: 400 });
  }

  const seededRating = seedRatingFromHandicap(handicap);
  const ratedMatches = player.rated_matches_snooker ?? 0;
  const shouldSeedElo = ratedMatches === 0;
  const updatePayload = {
    snooker_handicap: handicap,
    snooker_handicap_base: player.snooker_handicap_base ?? handicap,
    rating_snooker: shouldSeedElo ? seededRating : player.rating_snooker ?? seededRating,
    peak_rating_snooker: shouldSeedElo ? seededRating : player.peak_rating_snooker ?? player.rating_snooker ?? seededRating,
  };

  const updateRes = await adminClient.from("players").update(updatePayload).eq("id", player.id);
  if (updateRes.error) {
    return NextResponse.json({ error: updateRes.error.message }, { status: 400 });
  }

  const historyRes = await adminClient.from("snooker_handicap_history").insert({
    player_id: player.id,
    previous_handicap: player.snooker_handicap ?? 0,
    new_handicap: handicap,
    delta: handicap - (player.snooker_handicap ?? 0),
    reason: "Initial handicap allocation by Super User",
    changed_by: authData.user.id,
    fixture_id: null,
  });

  if (historyRes.error) {
    return NextResponse.json({ error: historyRes.error.message }, { status: 400 });
  }

  await adminClient.from("audit_logs").insert({
    actor_user_id: authData.user.id,
    actor_email: requesterEmail,
    actor_role: "owner",
    action: "assign_snooker_handicap",
    entity_type: "player",
    entity_id: player.id,
    summary: `Assigned starting snooker handicap ${handicap > 0 ? `+${handicap}` : handicap} to ${player.full_name?.trim() || player.display_name}.`,
    meta: {
      seededRating: shouldSeedElo ? seededRating : null,
      ratedMatches,
      baseline: player.snooker_handicap_base ?? handicap,
    },
  });

  return NextResponse.json({
    ok: true,
    playerId: player.id,
    handicap,
    seededRating: shouldSeedElo ? seededRating : null,
  });
}
