import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
type RouteContext = { params: Promise<{ competitionId: string; weekStart: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { competitionId, weekStart } = await context.params;
  if (!supabaseUrl || !serviceRoleKey || !/^[0-9a-f-]{36}$/i.test(competitionId) || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: "Weekly review not found." }, { status: 404 });
  }
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const result = await client.from("weekly_league_reviews").select("report_data,published_at").eq("competition_id", competitionId).eq("week_start", weekStart).eq("status", "published").maybeSingle();
  if (result.error || !result.data) return NextResponse.json({ error: "This weekly review has not been published." }, { status: 404 });
  return NextResponse.json({ report: result.data.report_data, publishedAt: result.data.published_at }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
