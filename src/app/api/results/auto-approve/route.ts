import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tryAutoApproveMatchingResult } from "@/lib/result-auto-approval";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const authResult = await authClient.auth.getUser(token);
  const user = authResult.data.user;
  if (authResult.error || !user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
  if (!matchId) return NextResponse.json({ error: "matchId is required." }, { status: 400 });

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const [appUserResult, matchResult] = await Promise.all([
    client.from("app_users").select("role,linked_player_id,email").eq("id", user.id).maybeSingle(),
    client.from("matches").select("player1_id,player2_id,team1_player1_id,team1_player2_id,team2_player1_id,team2_player2_id").eq("id", matchId).maybeSingle(),
  ]);
  if (appUserResult.error || matchResult.error || !appUserResult.data || !matchResult.data) return NextResponse.json({ error: "Fixture access could not be verified." }, { status: 403 });
  const role = appUserResult.data.role ?? "user";
  const linkedPlayerId = appUserResult.data.linked_player_id;
  const participantIds = [matchResult.data.player1_id, matchResult.data.player2_id, matchResult.data.team1_player1_id, matchResult.data.team1_player2_id, matchResult.data.team2_player1_id, matchResult.data.team2_player2_id];
  if (!['admin', 'owner'].includes(role) && (!linkedPlayerId || !participantIds.includes(linkedPlayerId))) {
    return NextResponse.json({ error: "You can only compare submissions for your own fixture." }, { status: 403 });
  }
  const result = await tryAutoApproveMatchingResult(client, matchId, {
    actorUserId: user.id,
    actorEmail: appUserResult.data.email ?? user.email ?? null,
    actorRole: role,
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
