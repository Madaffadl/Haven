import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * Sign-in code delivery.
 *
 * A narrow interface, like the push sender: the transport needs credentials
 * the repo does not carry. With RESEND_API_KEY set, codes go out through
 * Resend's HTTP API. Without it they are logged, so the whole sign-in flow
 * works on a laptop before any account exists.
 */
export interface EmailSender {
  sendSignInCode(to: string, code: string): Promise<void>;
}

export const logEmailSender: EmailSender = {
  async sendSignInCode(to, code) {
    logger.info({ to, code }, 'sign-in code (no email transport configured: not sent)');
  },
};

export const resendEmailSender = (apiKey: string, from: string): EmailSender => ({
  async sendSignInCode(to, code) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        // The code leads the subject so it is readable from the notification
        // banner without opening the mail app.
        subject: `${code} is your Haven code`,
        text:
          `Your Haven sign-in code is ${code}\n\n` +
          'It expires in 10 minutes. If you did not ask for it, you can ignore this email.',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`resend rejected the email: ${response.status} ${await response.text()}`);
    }
  },
});

// Logging codes is a development convenience and a production account
// takeover. Refuse to boot rather than run like that.
if (env.NODE_ENV === 'production' && !env.RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY is required in production: sign-in codes must not be logged');
}

export const emailSender: EmailSender = env.RESEND_API_KEY
  ? resendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM)
  : logEmailSender;
