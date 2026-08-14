import nodemailer from "nodemailer";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing email configuration: ${name}`);
  return value;
}

export function hasMailerConfig() {
  const fromAddress = Boolean(process.env.EMAIL_FROM_ADDRESS);
  return fromAddress && Boolean(
    process.env.RESEND_API_KEY || (
    process.env.ZOHO_SMTP_HOST &&
    process.env.ZOHO_SMTP_PORT &&
    process.env.ZOHO_SMTP_USER &&
    process.env.ZOHO_SMTP_PASSWORD
    )
  );
}

export async function sendEmail(input: { to: string; bcc?: string; subject: string; text: string; html: string }) {
  if (!hasMailerConfig()) throw new Error("Email configuration is missing.");
  const address = requiredEnv("EMAIL_FROM_ADDRESS");
  const name = process.env.EMAIL_FROM_NAME?.trim() || "Rack & Frame Club";
  const from = `"${name.replaceAll('"', "")}" <${address}>`;
  if (process.env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": "rack-and-frame-club/1.0",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        ...(input.bcc ? { bcc: [input.bcc] } : {}),
        ...(process.env.EMAIL_REPLY_TO?.trim() ? { reply_to: process.env.EMAIL_REPLY_TO.trim() } : {}),
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });
    const result = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
    if (!response.ok || !result.id) throw new Error(result.message || result.name || `Resend returned ${response.status}.`);
    return { messageId: result.id, provider: "Resend" };
  }
  const transport = nodemailer.createTransport({
    host: requiredEnv("ZOHO_SMTP_HOST"),
    port: Number(requiredEnv("ZOHO_SMTP_PORT")),
    secure: String(process.env.ZOHO_SMTP_SECURE || "true") === "true",
    auth: { user: requiredEnv("ZOHO_SMTP_USER"), pass: requiredEnv("ZOHO_SMTP_PASSWORD") },
  });
  return transport.sendMail({
    from,
    to: input.to,
    bcc: input.bcc,
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}
