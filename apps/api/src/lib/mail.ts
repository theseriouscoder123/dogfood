// Outgoing email. In Docker this goes to Mailpit (http://localhost:8025), so
// invites and password resets work fully offline. A failed send never fails the
// request that triggered it; it is logged instead.
import nodemailer from "nodemailer";
import { config } from "../config";

const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;

export type Mail = { to: string; subject: string; heading: string; body: string[]; action?: { label: string; url: string } };

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function render(m: Mail): { text: string; html: string } {
  const text = [m.heading, "", ...m.body, ...(m.action ? ["", `${m.action.label}: ${m.action.url}`] : [])].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5fa;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0e1330">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;border:1px solid #e3e6f0">
<tr><td style="padding:22px 28px;border-bottom:1px solid #eef0f6;font-weight:700;font-size:15px;letter-spacing:.2px">
<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#3346f0;margin-right:8px"></span>Dogfood</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 14px;font-size:20px">${escape(m.heading)}</h1>
${m.body.map((p) => `<p style="margin:0 0 12px;line-height:1.55;color:#40465e">${escape(p)}</p>`).join("")}
${m.action ? `<p style="margin:22px 0 6px"><a href="${escape(m.action.url)}" style="background:#3346f0;color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:600;display:inline-block">${escape(m.action.label)}</a></p>
<p style="margin:14px 0 0;font-size:12px;color:#7a8099;word-break:break-all">${escape(m.action.url)}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

export async function sendMail(m: Mail): Promise<boolean> {
  const { text, html } = render(m);
  if (!transport) {
    console.log(`[mail] to=${m.to} subject="${m.subject}"\n${text}`);
    return true;
  }
  try {
    await transport.sendMail({ from: config.mailFrom, to: m.to, subject: m.subject, text, html });
    return true;
  } catch (err) {
    console.error(`[mail] failed to send "${m.subject}" to ${m.to}:`, (err as Error).message);
    return false;
  }
}

export const absoluteUrl = (path: string) => `${config.publicBaseUrl.replace(/\/$/, "")}${path}`;
