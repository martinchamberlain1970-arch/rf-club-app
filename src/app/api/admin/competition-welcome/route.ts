import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getWelcomeCandidate, sendCompetitionWelcome } from "@/lib/competition-welcome";
import { getEmailDeliveryStatus } from "@/lib/mailer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_OWNER_EMAIL ?? "").trim().toLowerCase();

async function authorize(request: NextRequest) {
  if (!supabaseUrl || !serviceRoleKey) return null;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await client.auth.getUser(token);
  const user = userResult.data.user;
  if (!user) return null;
  const appUserResult = await client.from("app_users").select("role").eq("id", user.id).maybeSingle();
  const role = String(appUserResult.data?.role ?? "").toLowerCase();
  const isOwner = ["owner", "super"].includes(role) || Boolean(superAdminEmail && user.email?.toLowerCase() === superAdminEmail);
  if (!isOwner && role !== "admin") return null;
  return { client, user, role: isOwner ? "owner" : role };
}

async function welcomeRows(auth: NonNullable<Awaited<ReturnType<typeof authorize>>>, competitionId: string, verifyDelivery: boolean) {
  const entriesResult = await auth.client.from("competition_entries").select("id").eq("competition_id", competitionId).eq("status", "approved").order("created_at");
  if (entriesResult.error) throw entriesResult.error;
  const entryIds = (entriesResult.data ?? []).map((entry) => entry.id);
  const logsResult = entryIds.length
    ? await auth.client.from("audit_logs").select("id,created_at,action,entity_id,meta").in("entity_id", entryIds).in("action", ["competition_welcome_sent", "competition_welcome_failed"]).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (logsResult.error) throw logsResult.error;
  const latestLogByEntry = new Map<string, { id: string; created_at: string; action: string; entity_id: string; meta: Record<string, unknown> | null }>();
  for (const log of logsResult.data ?? []) if (log.entity_id && !latestLogByEntry.has(log.entity_id)) latestLogByEntry.set(log.entity_id, log as never);
  return Promise.all(entryIds.map(async (entryId) => {
    const candidate = await getWelcomeCandidate(auth.client, entryId);
    if (!candidate) return null;
    const log = latestLogByEntry.get(entryId) ?? null;
    const messageId = typeof log?.meta?.message_id === "string" ? log.meta.message_id : null;
    const delivery = verifyDelivery && messageId ? await getEmailDeliveryStatus(messageId) : null;
    return {
      entryId,
      playerName: candidate.playerName,
      email: candidate.email,
      competitionName: candidate.competitionName,
      status: log?.action === "competition_welcome_sent" ? "sent" : log?.action === "competition_welcome_failed" ? "failed" : candidate.email ? "missing" : "no_email",
      sentAt: log?.action === "competition_welcome_sent" ? log.created_at : null,
      messageId,
      delivery,
      error: log?.action === "competition_welcome_failed" ? String(log.meta?.error ?? "Email failed") : null,
    };
  })).then((rows) => rows.filter(Boolean));
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const competitionId = request.nextUrl.searchParams.get("competitionId") ?? "";
  const verifyDelivery = request.nextUrl.searchParams.get("verify") === "true";
  if (!competitionId) return NextResponse.json({ error: "Competition id is required." }, { status: 400 });
  try {
    const rows = await welcomeRows(auth, competitionId, verifyDelivery);
    return NextResponse.json({
      rows,
      totals: {
        approved: rows.length,
        sent: rows.filter((row) => row?.status === "sent").length,
        missing: rows.filter((row) => row?.status === "missing").length,
        failed: rows.filter((row) => row?.status === "failed").length,
        noEmail: rows.filter((row) => row?.status === "no_email").length,
        delivered: rows.filter((row) => row?.delivery?.status === "delivered").length,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Welcome-email audit failed." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const competitionId = String(body?.competitionId ?? "");
  const entryId = body?.entryId ? String(body.entryId) : null;
  const force = body?.force === true;
  if (!competitionId && !entryId) return NextResponse.json({ error: "Competition or entry id is required." }, { status: 400 });
  const entryIds = entryId
    ? [entryId]
    : ((await auth.client.from("competition_entries").select("id").eq("competition_id", competitionId).eq("status", "approved")).data ?? []).map((entry) => entry.id);
  const results = [];
  for (const id of entryIds) results.push(await sendCompetitionWelcome(auth.client, id, { user: auth.user, role: auth.role }, { force }));
  return NextResponse.json({
    ok: true,
    sent: results.filter((result) => result.status === "sent").length,
    alreadySent: results.filter((result) => result.status === "already_sent").length,
    noEmail: results.filter((result) => result.status === "no_email").length,
    failed: results.filter((result) => result.status === "failed" || result.status === "not_configured").length,
  });
}
