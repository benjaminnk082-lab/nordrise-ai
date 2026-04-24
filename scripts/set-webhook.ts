/**
 * set-webhook.ts
 *
 * Registers the Telegram webhook pointing at GATEWAY_PUBLIC_URL/telegram,
 * with the X-Telegram-Bot-Api-Secret-Token header secret.
 *
 * Usage (after first Railway deploy):
 *   GATEWAY_PUBLIC_URL=https://nordrise-ai.up.railway.app npm run set-webhook
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from the environment.
 */

import 'dotenv/config';

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const publicUrl = process.env.GATEWAY_PUBLIC_URL;

  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN missing');
  if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET missing (run `npm run gen-secret`)');
  if (!publicUrl) throw new Error('GATEWAY_PUBLIC_URL missing');

  const webhookUrl = new URL('/telegram', publicUrl).toString();

  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    }),
  });

  const body = (await res.json()) as { ok?: boolean; description?: string };
  if (!res.ok || !body.ok) {
    console.error('[set-webhook] failed:', body);
    process.exit(1);
  }

  console.log(`[set-webhook] OK. Webhook set to ${webhookUrl}`);

  const info = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  console.log('[set-webhook] getWebhookInfo:', await info.json());
}

main().catch((err) => {
  console.error('[set-webhook] error:', err);
  process.exit(1);
});
