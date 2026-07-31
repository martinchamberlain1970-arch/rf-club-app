import nodemailer from "nodemailer";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing email configuration: ${name}`);
  return value;
}

export function hasMailerConfig() {
  return Boolean(
    process.env.ZOHO_SMTP_HOST &&
    process.env.ZOHO_SMTP_PORT &&
    process.env.ZOHO_SMTP_USER &&
    process.env.ZOHO_SMTP_PASSWORD &&
    process.env.EMAIL_FROM_ADDRESS
  );
}

export async function sendEmail(input: { to: string; bcc?: string; subject: string; text: string; html: string }) {
  if (!hasMailerConfig()) throw new Error("Email configuration is missing.");
  const transport = nodemailer.createTransport({
    host: requiredEnv("ZOHO_SMTP_HOST"),
    port: Number(requiredEnv("ZOHO_SMTP_PORT")),
    secure: String(process.env.ZOHO_SMTP_SECURE || "true") === "true",
    auth: { user: requiredEnv("ZOHO_SMTP_USER"), pass: requiredEnv("ZOHO_SMTP_PASSWORD") },
  });
  const address = requiredEnv("EMAIL_FROM_ADDRESS");
  const name = process.env.EMAIL_FROM_NAME?.trim() || "Rack & Frame Club";
  return transport.sendMail({
    from: `"${name.replaceAll('"', "")}" <${address}>`,
    to: input.to,
    bcc: input.bcc,
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}
