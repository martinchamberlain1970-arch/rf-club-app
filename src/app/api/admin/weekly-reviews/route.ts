import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildWeeklyReview } from "@/lib/weekly-review";

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
  const appUserResult = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const isSuper = appUserResult.data?.role === "owner" || Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail);
  return isSuper ? { client, user } : null;
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Super User access required." }, { status: 403 });
  const { client } = auth;
  const [competitionsResult, matchesResult, reviewsResult] = await Promise.all([
    client.from("competitions").select("id,name,is_archived,is_completed").eq("competition_format", "league").order("created_at", { ascending: false }),
    client.from("matches").select("competition_id,scheduled_for,status,player1_id,player2_id").eq("is_archived", false).not("scheduled_for", "is", null).order("scheduled_for", { ascending: false }),
    client.from("weekly_league_reviews").select("id,competition_id,week_start,status,generated_at,published_at,report_data").order("week_start", { ascending: false }),
  ]);
  const error = competitionsResult.error || matchesResult.error || reviewsResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const weekMap = new Map<string, { competitionId: string; weekStart: string; total: number; resolved: number }>();
  for (const match of matchesResult.data ?? []) {
    if (!match.scheduled_for || (match.player1_id && match.player1_id === match.player2_id)) continue;
    const key = `${match.competition_id}:${match.scheduled_for}`;
    const current = weekMap.get(key) ?? { competitionId: match.competition_id, weekStart: match.scheduled_for, total: 0, resolved: 0 };
    current.total += 1;
    if (["complete", "bye"].includes(match.status)) current.resolved += 1;
    weekMap.set(key, current);
  }
  return NextResponse.json({ competitions: competitionsResult.data ?? [], weeks: [...weekMap.values()], reviews: reviewsResult.data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Super User access required." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const competitionId = typeof body.competitionId === "string" ? body.competitionId : "";
  const weekStart = typeof body.weekStart === "string" ? body.weekStart.slice(0, 10) : "";
  const action = body.action === "publish" ? "publish" : body.action === "unpublish" ? "unpublish" : "generate";
  if (!/^[0-9a-f-]{36}$/i.test(competitionId) || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return NextResponse.json({ error: "Competition and fixture week are required." }, { status: 400 });
  const { client, user } = auth;
  if (action === "unpublish") {
    const update = await client.from("weekly_league_reviews").update({ status: "draft", published_at: null, published_by_user_id: null }).eq("competition_id", competitionId).eq("week_start", weekStart).select("*").maybeSingle();
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 400 });
    return NextResponse.json({ review: update.data });
  }
  try {
    const report = await buildWeeklyReview(client, competitionId, weekStart);
    const published = action === "publish";
    if (published && !report.allResolved) {
      return NextResponse.json({ error: `${report.unresolvedFixtures} fixture${report.unresolvedFixtures === 1 ? " is" : "s are"} still outstanding. Complete, approve or void them before publishing this weekly review.` }, { status: 409 });
    }
    const upsert = await client.from("weekly_league_reviews").upsert({
      competition_id: competitionId,
      week_start: weekStart,
      status: published ? "published" : "draft",
      report_data: report,
      generated_at: report.generatedAt,
      generated_by_user_id: user.id,
      published_at: published ? new Date().toISOString() : null,
      published_by_user_id: published ? user.id : null,
    }, { onConflict: "competition_id,week_start" }).select("*").single();
    if (upsert.error) return NextResponse.json({ error: upsert.error.message }, { status: 400 });
    await client.from("audit_logs").insert({
      actor_user_id: user.id,
      actor_email: user.email ?? null,
      actor_role: "owner",
      action: published ? "weekly_review_published" : "weekly_review_generated",
      entity_type: "competition",
      entity_id: competitionId,
      summary: `${published ? "Published" : "Generated"} weekly review for ${weekStart}.`,
      meta: { competitionId, weekStart, allResolved: report.allResolved, unresolvedFixtures: report.unresolvedFixtures },
    });
    return NextResponse.json({ review: upsert.data, report });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Weekly review could not be generated." }, { status: 400 });
  }
}
