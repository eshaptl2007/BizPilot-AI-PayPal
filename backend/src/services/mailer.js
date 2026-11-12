// Optional SMTP mail sender (nodemailer). With no SMTP_HOST configured, nothing is sent and the
// caller falls back to logging the link (development only).
import { config } from '../config.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const mailConfigured = () => Boolean(config.smtp.host);

export async function sendResetEmail(user, link, minutes) {
  if (!mailConfigured()) return false;
  const { default: nodemailer } = await import('nodemailer');
  const { host, port, user: smtpUser, pass, from } = config.smtp;
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: smtpUser ? { user: smtpUser, pass } : undefined });
  await transport.sendMail({
    from,
    to: user.email,
    subject: 'Reset your BizPilot AI password',
    text: `Hi ${user.name},\n\nUse this link to choose a new password (valid for ${minutes} minutes):\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
    html: `<p>Hi ${esc(user.name)},</p><p><a href="${esc(link)}">Choose a new password</a> (link valid for ${minutes} minutes).</p><p>If you did not ask for this, you can ignore this email.</p>`,
  });
  return true;
}
