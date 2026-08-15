function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing email configuration: ${name}`);
  return value;
}

export function hasMailerConfig() {
  return Boolean(process.env.EMAIL_FROM_ADDRESS && process.env.RESEND_API_KEY);
}

type SendEmailInput = {
  to: string;
  bcc?: string;
  subject: string;
  text: string;
  html: string;
  fromAddress?: string;
  fromName?: string;
  replyTo?: string | null;
};

export async function sendEmail(input: SendEmailInput) {
  if (!hasMailerConfig()) throw new Error("Email configuration is missing.");
  const address = input.fromAddress?.trim() || requiredEnv("EMAIL_FROM_ADDRESS");
  const name = input.fromName?.trim() || process.env.EMAIL_FROM_NAME?.trim() || "Rack & Frame Club";
  const from = `"${name.replaceAll('"', "")}" <${address}>`;
  const replyTo = input.replyTo === null
    ? undefined
    : input.replyTo?.trim() || process.env.EMAIL_REPLY_TO?.trim() || undefined;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
      "User-Agent": "rack-and-frame-club/1.0",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      ...(input.bcc ? { bcc: [input.bcc] } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (!response.ok || !result.id) throw new Error(result.message || result.name || `Resend returned ${response.status}.`);
  return { messageId: result.id, provider: "Resend" as const };
}
