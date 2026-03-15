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
  rating_snooker: number | null;
  snooker_handicap: number | null;
  snooker_handicap_base: number | null;
};

function targetHandicapFromElo(rating: number) {
  const raw = (1000 - rating) / 5;
  return Math.round(raw / 4) * 4;
}

function stepToward(current: number, target: number) {
  const delta = target - current;
  if (delta === 0) return current;
  const step = Math.max(-4, Math.min(4, delta));
  return current + step;
}

export async function POST(req: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
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
  const playersRes = await adminClient
    .from("players")
    .select("id,rating_snooker,snooker_handicap,snooker_handicap_base")
    .eq("is_archived", false);

  if (playersRes.error) {
    return NextResponse.json({ error: playersRes.error.message }, { status: 400 });
  }

  const players = (playersRes.data ?? []) as PlayerRow[];
  const historyRows: Array<{
    player_id: string;
    previous_handicap: number;
    new_handicap: number;
    delta: number;
    reason: string;
    changed_by: string;
    fixture_id: null;
  }> = [];

  let updated = 0;

  for (const player of players) {
    const rating = Math.round(player.rating_snooker ?? 1000);
    const current = player.snooker_handicap ?? player.snooker_handicap_base ?? targetHandicapFromElo(rating);
    const target = targetHandicapFromElo(rating);
    const next = stepToward(current, target);
    const base = player.snooker_handicap_base ?? current;

    if (next === current && player.snooker_handicap_base !== null) {
      continue;
    }

    const updateRes = await adminClient
      .from("players")
      .update({
        snooker_handicap: next,
        snooker_handicap_base: base,
      })
      .eq("id", player.id);

    if (updateRes.error) {
      return NextResponse.json({ error: updateRes.error.message }, { status: 400 });
    }

    if (next !== current) {
      historyRows.push({
        player_id: player.id,
        previous_handicap: current,
        new_handicap: next,
        delta: next - current,
        reason: "Manual review from Elo",
        changed_by: authData.user.id,
        fixture_id: null,
      });
    }
    updated += 1;
  }

  if (historyRows.length) {
    const historyRes = await adminClient.from("snooker_handicap_history").insert(historyRows);
    if (historyRes.error) {
      return NextResponse.json({ error: historyRes.error.message }, { status: 400 });
    }
  }

  await adminClient.from("audit_logs").insert({
    actor_user_id: authData.user.id,
    actor_email: requesterEmail,
    actor_role: "owner",
    action: "snooker_handicap_review",
    entity_type: "app_user",
    entity_id: authData.user.id,
    summary: `Snooker handicaps recalculated from Elo for ${updated} players.`,
    meta: { updatedPlayers: updated, changedPlayers: historyRows.length },
  });

  return NextResponse.json({ ok: true, updatedPlayers: updated, changedPlayers: historyRows.length });
}
