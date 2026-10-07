import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendApprovedResultEmails } from "@/lib/result-approved-email";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const userResult = await authClient.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
  if (!matchId) return NextResponse.json({ error: "matchId is required." }, { status: 400 });
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const [appUserResult, matchResult] = await Promise.all([
    client.from("app_users").select("role,linked_player_id,email").eq("id", user.id).maybeSingle(),
    client.from("matches").select("player1_id,player2_id,status").eq("id", matchId).maybeSingle(),
  ]);
  const appUser = appUserResult.data; const match = matchResult.data;
  if (!appUser || !match) return NextResponse.json({ error: "Fixture access could not be verified." }, { status: 403 });
  const role = appUser.role ?? "user";
  if (!["admin", "owner"].includes(role) && ![match.player1_id, match.player2_id].includes(appUser.linked_player_id)) return NextResponse.json({ error: "Fixture access denied." }, { status: 403 });
  const results = await sendApprovedResultEmails(client, matchId, { user: { id: user.id, email: appUser.email ?? user.email }, role }).catch((error) => ({ error: error instanceof Error ? error.message : "Emails could not be sent." }));
  if (!Array.isArray(results)) return NextResponse.json(results, { status: 400 });
  return NextResponse.json({ ok: true, results });
}
