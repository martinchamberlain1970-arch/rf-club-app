import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasMailerConfig, sendEmail } from "@/lib/mailer";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !hasMailerConfig()) return NextResponse.json({ error: "Password-reset email is not configured." }, { status: 500 });
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Sign in again before sending a reset link." }, { status: 401 });

  const authClient = createClient(supabaseUrl, supabaseAnonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const userResult = await authClient.auth.getUser(token);
  const actor = userResult.data.user;
  if (!actor) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const actorEmail = actor.email?.trim().toLowerCase() ?? "";
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const actorRoleResult = await adminClient.from("app_users").select("role").eq("id", actor.id).maybeSingle();
  const actorRole = String(actorRoleResult.data?.role ?? "").toLowerCase();
  if (!(["owner", "super"].includes(actorRole) || Boolean(superAdminEmail && actorEmail === superAdminEmail))) return NextResponse.json({ error: "Super User access required." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const userId = String(body?.userId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: "Choose a valid registered user." }, { status: 400 });
  const targetResult = await adminClient.from("app_users").select("id,email").eq("id", userId).maybeSingle();
  if (targetResult.error) return NextResponse.json({ error: targetResult.error.message }, { status: 400 });
  const targetEmail = targetResult.data?.email?.trim().toLowerCase();
  if (!targetEmail) return NextResponse.json({ error: "That user does not have an email address." }, { status: 404 });

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://rf-club-app.vercel.app").replace(/\/$/, "");
  const linkResult = await adminClient.auth.admin.generateLink({ type: "recovery", email: targetEmail, options: { redirectTo: `${siteUrl}/auth/reset-password` } });
  if (linkResult.error || !linkResult.data.properties?.action_link) return NextResponse.json({ error: linkResult.error?.message || "Supabase could not create the reset link." }, { status: 400 });
  const resetLink = linkResult.data.properties.action_link;

  try {
    await sendEmail({
      to: targetEmail,
      subject: "Reset your Rack & Frame password",
      text: `A Rack & Frame administrator has sent you a password reset link.\n\nReset password: ${resetLink}\n\nIf you did not request help with your password, you can ignore this email.`,
      html: `<p>A Rack &amp; Frame administrator has sent you a password reset link.</p><p><a href="${escapeHtml(resetLink)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#0f766e;color:#fff;text-decoration:none;font-weight:700">Reset my password</a></p><p style="color:#475569;font-size:14px">If you did not request help with your password, you can ignore this email.</p>`,
    });
    const provider = process.env.RESEND_API_KEY ? "Resend" : "Zoho SMTP";
    await adminClient.from("audit_logs").insert({ actor_user_id: actor.id, actor_email: actorEmail || null, actor_role: actorRole || "owner", action: "password_reset_link_sent", entity_type: "app_user", entity_id: userId, summary: `Password reset link sent to ${targetEmail}.`, meta: { provider } });
    return NextResponse.json({ ok: true, provider });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The reset email could not be sent." }, { status: 502 });
  }
}
