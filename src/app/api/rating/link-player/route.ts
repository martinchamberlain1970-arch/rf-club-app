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
const leagueUpsertLinkUrl =
  process.env.LEAGUE_SHARED_LINK_UPSERT_URL?.trim() ?? "https://rf-league-app.vercel.app/api/rating/upsert-link";

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

  const requesterEmail = user.email?.trim().toLowerCase() ?? "";
  if (!superAdminEmail || requesterEmail !== superAdminEmail) {
    return NextResponse.json({ error: "Super User only." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const clubPlayerId = typeof body?.clubPlayerId === "string" ? body.clubPlayerId.trim() : "";
  const leaguePlayerId = typeof body?.leaguePlayerId === "string" ? body.leaguePlayerId.trim() : "";
  if (!clubPlayerId || !leaguePlayerId) {
    return NextResponse.json({ error: "clubPlayerId and leaguePlayerId are required." }, { status: 400 });
  }

  const leagueRes = await fetch(leagueUpsertLinkUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shared-rating-key": sharedRatingApiKey,
    },
    body: JSON.stringify({
      source_app: "club",
      source_player_id: clubPlayerId,
      league_player_id: leaguePlayerId,
    }),
  });

  const payload = (await leagueRes.json().catch(() => ({}))) as { error?: string; link?: unknown };
  if (!leagueRes.ok) {
    return NextResponse.json({ error: payload.error ?? "Failed to create shared player link." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, link: payload.link ?? null });
}
