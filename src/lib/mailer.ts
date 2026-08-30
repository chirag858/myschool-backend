import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '../config/env';
import { logger } from './logger';

/**
 * Transactional email via SMTP. Optional: if `SMTP_HOST` / `SMTP_USER` /
 * `SMTP_PASS` are unset, `isMailConfigured()` is false and callers skip the
 * send (dev/test), while `sendMail` throws a clear error if invoked anyway.
 * Swap the transport config here if the provider changes — callers only
 * depend on `sendMail`.
 */
let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function mailer(): Transporter {
  if (transporter) return transporter;
  if (!isMailConfigured()) {
    throw new Error('SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS missing)');
  }
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(input: MailInput): Promise<{ messageId: string }> {
  const from = env.SMTP_FROM || env.SMTP_USER || '';
  const info = await mailer().sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    ...(input.html ? { html: input.html } : {}),
  });
  logger.info('mail sent', { to: input.to, subject: input.subject, messageId: info.messageId });
  return { messageId: String(info.messageId) };
}
