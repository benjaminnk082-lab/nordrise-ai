/**
 * teamsOAuth.ts — interactive Microsoft 365 OAuth for the Teams connector.
 *
 * Flow (Authorization Code with PKCE-light, public client):
 *   1. Spin up a one-shot HTTP server on a random localhost port.
 *   2. Build the MS auth URL with redirect_uri pointing at our listener.
 *   3. Open the user's default browser; they sign in there.
 *   4. Microsoft redirects back to /callback?code=XXX&state=YYY.
 *   5. Exchange the code for a refresh_token via /token endpoint.
 *   6. Return the refresh token to the caller.
 *
 * The refresh token is long-lived (typically 90 days of inactivity tolerance
 * with infinite extension on use). We never persist the access token —
 * Sean swaps refresh→access on every request he needs.
 *
 * SECURITY NOTES
 * - Server only binds to 127.0.0.1 (loopback). Random port reduces
 *   collision risk with anything else listening on the host.
 * - State token (32 random bytes, base64url) is verified to mitigate CSRF.
 * - Server self-shuts after the first valid callback OR after 5 minutes.
 * - Refresh token returned to renderer so the user can paste it into
 *   settings (or it can be stored automatically by the caller).
 */
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { shell, net } from 'electron';

const SCOPE = [
  'offline_access',
  'Chat.ReadWrite',
  'ChatMessage.Send',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.ReadWrite',
  'User.Read',
].join(' ');

export interface TeamsOAuthInput {
  clientId: string;
  tenantId: string;
}

export interface TeamsOAuthResult {
  ok: boolean;
  refreshToken?: string;
  error?: string;
}

const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * HTML body returned to the user's browser after the redirect. Plain
 * inline HTML — no asset references — so it renders even when the
 * window is closed before assets load.
 */
function successPage(): string {
  return `<!doctype html>
<html lang="nb"><head><meta charset="utf-8" />
<title>Nordrise Control — innlogging fullført</title>
<style>
  body { margin:0;padding:48px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;
         background:#050509;color:#f4f4f7;display:flex;flex-direction:column;
         align-items:center;justify-content:center;min-height:100vh; }
  .ok { width:64px;height:64px;border-radius:50%;
        background:linear-gradient(135deg,#3fc57f,#2ea35f);
        display:flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:24px; }
  h1 { font-size:24px;font-weight:600;margin:0 0 12px; }
  p { color:rgba(244,244,247,0.65);max-width:420px;text-align:center;line-height:1.5; }
</style></head>
<body>
<div class="ok">✓</div>
<h1>Innlogging fullført</h1>
<p>Du kan lukke denne fanen. Sean har fått tilgang og connectoren er klar.</p>
</body></html>`;
}

function errorPage(detail: string): string {
  const safe = detail.replace(/[<>&]/g, '');
  return `<!doctype html>
<html lang="nb"><head><meta charset="utf-8" />
<title>Nordrise Control — innlogging feilet</title>
<style>
  body { margin:0;padding:48px;font-family:system-ui,sans-serif;background:#1a0a0a;color:#ffefef;
         display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh; }
  h1 { color:#ff8a8a; }
  pre { background:rgba(255,138,138,0.08);padding:12px 16px;border-radius:8px;
        max-width:480px;overflow:auto;font-size:12px; }
</style></head>
<body><h1>Innlogging feilet</h1><pre>${safe}</pre>
<p>Lukk fanen og prøv igjen i Nordrise Control.</p></body></html>`;
}

export async function runTeamsOAuth(
  input: TeamsOAuthInput,
): Promise<TeamsOAuthResult> {
  const clientId = input.clientId.trim();
  const tenantId = input.tenantId.trim() || 'common';
  if (!clientId) return { ok: false, error: 'missing_client_id' };

  const expectedState = randomBytes(32).toString('base64url');

  return new Promise<TeamsOAuthResult>((resolve) => {
    let server: Server | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let settled = false;

    const finish = (result: TeamsOAuthResult) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try {
        server?.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    server = createServer(async (req, res) => {
      try {
        if (!req.url) {
          res.writeHead(400);
          res.end('no url');
          return;
        }
        const u = new URL(req.url, `http://127.0.0.1`);
        if (u.pathname !== '/callback') {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const code = u.searchParams.get('code');
        const state = u.searchParams.get('state');
        const errParam = u.searchParams.get('error');
        if (errParam) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          res.end(errorPage(errParam));
          finish({ ok: false, error: errParam });
          return;
        }
        if (!code || state !== expectedState) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          res.end(errorPage('Manglende eller ugyldig state/code.'));
          finish({ ok: false, error: 'invalid_callback' });
          return;
        }
        // Exchange code for tokens.
        const port = (server!.address() as { port: number }).port;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const tokenResp = await net.fetch(
          `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri,
              scope: SCOPE,
            }).toString(),
          },
        );
        const tokenBody = (await tokenResp.json().catch(() => null)) as {
          refresh_token?: string;
          error_description?: string;
          error?: string;
        } | null;
        if (!tokenResp.ok || !tokenBody?.refresh_token) {
          const detail =
            tokenBody?.error_description ?? tokenBody?.error ?? `http_${tokenResp.status}`;
          res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
          res.end(errorPage(detail));
          finish({ ok: false, error: detail });
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(successPage());
        finish({ ok: true, refreshToken: tokenBody.refresh_token });
      } catch (err) {
        try {
          res.writeHead(500);
          res.end('server error');
        } catch {
          // ignore double-write
        }
        finish({ ok: false, error: (err as Error).message });
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server!.address() as { port: number }).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl =
        `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize` +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_mode=query` +
        `&scope=${encodeURIComponent(SCOPE)}` +
        `&state=${encodeURIComponent(expectedState)}` +
        `&prompt=select_account`;
      void shell.openExternal(authUrl);
    });

    timeoutHandle = setTimeout(() => {
      finish({ ok: false, error: 'timeout' });
    }, TIMEOUT_MS);
  });
}
