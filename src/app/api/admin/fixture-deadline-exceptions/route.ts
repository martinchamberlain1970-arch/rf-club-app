import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getLeagueFixtureEffectiveFinalDeadline, getLeagueFixtureFinalDeadline } from "@/lib/league-deadline";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();

async function authorize(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return { error: "Server is not configured.", status: 500 } as const;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Unauthorized.", status: 401 } as const;
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return { error: "Unauthorized.", status: 401 } as const;
  const appUser = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const role = String(appUser.data?.role ?? "");
  if (!(["owner", "super", "super_user", "admin"].includes(role)) && !(superAdminEmail && user.email?.toLowerCase() === superAdminEmail)) {
    return { error: "Club Manager access required.", status: 403 } as const;
  }
  return { client, user, role: role || "owner" } as const;
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null);
  const matchId = String(body?.matchId ?? "").trim();
  const extendedUntil = String(body?.extendedUntil ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  if (!matchId || !/^\d{4}-\d{2}-\d{2}$/.test(extendedUntil)) return NextResponse.json({ error: "Choose a fixture and a valid exception deadline." }, { status: 400 });
  if (reason.length < 5 || reason.length > 300) return NextResponse.json({ error: "Add a reason between 5 and 300 characters." }, { status: 400 });

  const matchResult = await auth.client.from("matches").select("id,competition_id,scheduled_for,status,competitions(name,competition_format,league_schedule_mode,is_archived,is_completed)").eq("id", matchId).maybeSingle();
  if (matchResult.error) return NextResponse.json({ error: matchResult.error.message }, { status: 400 });
  const match = matchResult.data;
  const competition = Array.isArray(match?.competitions) ? match.competitions[0] : match?.competitions;
  if (!match || !competition || competition.competition_format !== "league" || competition.league_schedule_mode === "one_day" || competition.is_archived || competition.is_completed || !["pending", "in_progress"].includes(match.status)) {
    return NextResponse.json({ error: "Only an outstanding fixture in an active weekly league can receive an exception." }, { status: 400 });
  }
  const normalDeadline = getLeagueFixtureFinalDeadline(match.scheduled_for, competition.name);
  const effectiveDeadline = getLeagueFixtureEffectiveFinalDeadline(match.scheduled_for, competition.name, extendedUntil);
  if (!normalDeadline || !effectiveDeadline || effectiveDeadline <= normalDeadline || effectiveDeadline <= new Date()) {
    return NextResponse.json({ error: "The exception must extend the fixture beyond its current final deadline and be in the future." }, { status: 400 });
  }

  const saved = await auth.client.from("league_fixture_deadline_exceptions").upsert({
    match_id: matchId,
    extended_until: extendedUntil,
    reason,
    is_active: true,
    created_by_user_id: auth.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "match_id" }).select("id").single();
  if (saved.error) return NextResponse.json({ error: saved.error.message }, { status: 400 });
  await auth.client.from("audit_logs").insert({
    actor_user_id: auth.user.id,
    actor_email: auth.user.email ?? null,
    actor_role: auth.role,
    action: "fixture_deadline_exception_saved",
    entity_type: "match",
    entity_id: matchId,
    summary: `Exceptional playing deadline extended to ${extendedUntil}.`,
    meta: { extended_until: extendedUntil, reason },
  });
  return NextResponse.json({ ok: true, id: saved.data.id, effectiveDeadline: effectiveDeadline.toISOString() });
}

export async function DELETE(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const matchId = new URL(request.url).searchParams.get("matchId")?.trim() ?? "";
  if (!matchId) return NextResponse.json({ error: "Match id is required." }, { status: 400 });
  const updated = await auth.client.from("league_fixture_deadline_exceptions").update({ is_active: false, updated_at: new Date().toISOString() }).eq("match_id", matchId).eq("is_active", true).select("id").maybeSingle();
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 400 });
  if (!updated.data) return NextResponse.json({ error: "No active exception was found." }, { status: 404 });
  await auth.client.from("audit_logs").insert({ actor_user_id: auth.user.id, actor_email: auth.user.email ?? null, actor_role: auth.role, action: "fixture_deadline_exception_removed", entity_type: "match", entity_id: matchId, summary: "Exceptional playing deadline removed.", meta: {} });
  return NextResponse.json({ ok: true });
}
