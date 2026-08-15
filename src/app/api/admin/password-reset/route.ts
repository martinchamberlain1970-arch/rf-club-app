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
    const safeResetLink = escapeHtml(resetLink);
    await sendEmail({
      to: targetEmail,
      fromName: "Rack & Frame",
      fromAddress: process.env.PASSWORD_RESET_FROM_ADDRESS?.trim() || "no-reply@mail.rackandframe.app",
      replyTo: null,
      subject: "Reset your Rack & Frame password",
      text: `Rack & Frame Club\n\nRESET YOUR PASSWORD\n\nA Rack & Frame administrator has sent you this secure link to help you regain access to your account.\n\nTo choose a new password, open the link below:\n${resetLink}\n\nFor your security:\n- Use this link as soon as possible. If it has expired, request a new one from the sign-in screen or contact the club administrator.\n- The link can only be used to reset the account registered to this email address.\n- Rack & Frame will never ask you to send your password by email or message.\n\nIf you were not expecting this email, you can safely ignore it. Your existing password will remain unchanged.\n\nRack & Frame Club\nCompetition, fixture and table-booking management`,
      html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Reset your Rack &amp; Frame password</title>
  </head>
  <body style="margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">Use this secure link to choose a new Rack &amp; Frame password.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f1f5f9">
      <tr>
        <td align="center" style="padding:28px 12px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,.08)">
            <tr>
              <td style="background:#0f766e;padding:26px 32px;color:#ffffff">
                <div style="font-size:24px;line-height:1.2;font-weight:700">Rack &amp; Frame</div>
                <div style="margin-top:6px;font-size:14px;line-height:1.4;color:#ccfbf1">Club competitions, fixtures and table bookings</div>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 32px 16px">
                <div style="font-size:12px;line-height:1.4;font-weight:700;letter-spacing:1.4px;color:#0f766e">ACCOUNT ACCESS</div>
                <h1 style="margin:8px 0 14px;font-size:27px;line-height:1.25;color:#0f172a">Reset your password</h1>
                <p style="margin:0;font-size:16px;line-height:1.65;color:#334155">A Rack &amp; Frame administrator has sent you this secure link to help you regain access to your account.</p>
                <p style="margin:18px 0 0;font-size:16px;line-height:1.65;color:#334155">Select the button below, then enter and confirm your new password.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 32px 28px">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="border-radius:10px;background:#0f766e">
                      <a href="${safeResetLink}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:16px;line-height:1.2;font-weight:700;text-decoration:none">Choose a new password</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;border-left:4px solid #fbbf24;border-radius:8px">
                  <tr>
                    <td style="padding:16px 18px">
                      <div style="font-size:14px;line-height:1.4;font-weight:700;color:#0f172a">Keeping your account secure</div>
                      <div style="margin-top:6px;font-size:14px;line-height:1.55;color:#475569">Please use this link promptly. If it has expired, request another link from the sign-in screen or contact the club administrator. Rack &amp; Frame will never ask you to send your password by email or message.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 30px">
                <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#475569">If you were not expecting this email, you can safely ignore it. Your existing password will remain unchanged.</p>
                <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#64748b">If the button does not work, copy and paste this address into your browser:</p>
                <p style="margin:0;word-break:break-all;font-size:12px;line-height:1.5"><a href="${safeResetLink}" style="color:#0f766e;text-decoration:underline">${safeResetLink}</a></p>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;font-size:12px;line-height:1.5;color:#64748b">This is an automated account-security email from Rack &amp; Frame Club.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    });
    const provider = process.env.RESEND_API_KEY ? "Resend" : "Zoho SMTP";
    await adminClient.from("audit_logs").insert({ actor_user_id: actor.id, actor_email: actorEmail || null, actor_role: actorRole || "owner", action: "password_reset_link_sent", entity_type: "app_user", entity_id: userId, summary: `Password reset link sent to ${targetEmail}.`, meta: { provider } });
    return NextResponse.json({ ok: true, provider });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The reset email could not be sent." }, { status: 502 });
  }
}
