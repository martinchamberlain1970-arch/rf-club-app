export const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character] ?? character);

type EmailButton = { label: string; url: string };

export function brandedEmail(input: {
  eyebrow?: string;
  title: string;
  intro: string;
  bodyHtml: string;
  primaryButton?: EmailButton;
  secondaryButton?: EmailButton;
  footerNote?: string;
}) {
  const button = (item: EmailButton, secondary = false) => `<a href="${escapeEmailHtml(item.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 18px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:700;${secondary ? "border:1px solid #0f766e;color:#0f766e;background:#ffffff" : "background:#0f766e;color:#ffffff"}">${escapeEmailHtml(item.label)}</a>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeEmailHtml(input.intro)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #dbe4ee;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(15,23,42,.08)">
      <tr><td style="background:linear-gradient(135deg,#134e4a,#0f172a);padding:26px 30px;color:#ffffff">
        <div style="font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#bef264">${escapeEmailHtml(input.eyebrow ?? "Rack & Frame Club")}</div>
        <div style="margin-top:8px;font-size:28px;line-height:1.2;font-weight:800">${escapeEmailHtml(input.title)}</div>
      </td></tr>
      <tr><td style="padding:30px">
        <p style="margin:0 0 18px;font-size:17px;line-height:1.65;color:#334155">${escapeEmailHtml(input.intro)}</p>
        <div style="font-size:15px;line-height:1.7;color:#334155">${input.bodyHtml}</div>
        ${input.primaryButton || input.secondaryButton ? `<div style="margin-top:24px">${input.primaryButton ? button(input.primaryButton) : ""}${input.secondaryButton ? button(input.secondaryButton, true) : ""}</div>` : ""}
        ${input.footerNote ? `<div style="margin-top:24px;padding:14px 16px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:13px;line-height:1.55;color:#64748b">${escapeEmailHtml(input.footerNote)}</div>` : ""}
      </td></tr>
      <tr><td style="padding:18px 30px;background:#0f172a;color:#cbd5e1;font-size:12px;line-height:1.6">
        Rack &amp; Frame Club · Competition, fixture and table-booking management<br>
        © ${new Date().getFullYear()} Martin Chamberlain. All rights reserved.
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
