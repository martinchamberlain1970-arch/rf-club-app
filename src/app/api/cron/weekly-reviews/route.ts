import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildWeeklyReview } from "@/lib/weekly-review";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  const authHeader = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const authorized = cronSecret ? authHeader === cronSecret : Boolean(request.headers.get("x-vercel-cron"));
  if (!authorized) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const competitionsResult = await client.from("competitions").select("id").eq("competition_format", "league").neq("league_schedule_mode", "one_day").eq("is_archived", false);
  if (competitionsResult.error) return NextResponse.json({ error: competitionsResult.error.message }, { status: 400 });
  const competitionIds = (competitionsResult.data ?? []).map((competition) => competition.id);
  if (!competitionIds.length) return NextResponse.json({ ok: true, generated: [] });
  const [matchesResult, existingResult] = await Promise.all([
    client.from("matches").select("competition_id,scheduled_for,status,player1_id,player2_id").in("competition_id", competitionIds).eq("is_archived", false).not("scheduled_for", "is", null),
    client.from("weekly_league_reviews").select("competition_id,week_start"),
  ]);
  if (matchesResult.error || existingResult.error) return NextResponse.json({ error: matchesResult.error?.message || existingResult.error?.message }, { status: 400 });
  const existing = new Set((existingResult.data ?? []).map((review) => `${review.competition_id}:${review.week_start}`));
  const grouped = new Map<string, { competitionId: string; weekStart: string; statuses: string[] }>();
  for (const match of matchesResult.data ?? []) {
    if (!match.scheduled_for || (match.player1_id && match.player1_id === match.player2_id)) continue;
    const key = `${match.competition_id}:${match.scheduled_for}`;
    const group: { competitionId: string; weekStart: string; statuses: string[] } = grouped.get(key) ?? { competitionId: match.competition_id, weekStart: match.scheduled_for, statuses: [] };
    group.statuses.push(match.status);
    grouped.set(key, group);
  }
  const generated: string[] = [];
  for (const [key, group] of grouped) {
    if (existing.has(key) || !group.statuses.length || !group.statuses.every((status) => ["complete", "bye"].includes(status))) continue;
    const report = await buildWeeklyReview(client, group.competitionId, group.weekStart);
    const insert = await client.from("weekly_league_reviews").insert({ competition_id: group.competitionId, week_start: group.weekStart, status: "draft", report_data: report, generated_at: report.generatedAt });
    if (!insert.error) generated.push(key);
  }
  return NextResponse.json({ ok: true, generated });
}
