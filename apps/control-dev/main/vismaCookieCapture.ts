/**
 * vismaCookieCapture.ts — interactive cookie harvest for Visma InSchool.
 *
 * Visma has no public student API. The official InSchool app authenticates
 * via standard browser-session cookies. To let Sean reach the timetable /
 * absence / messages endpoints we open a normal Electron BrowserWindow at
 * the school's login URL, let the user sign in (Feide, BankID — whatever),
 * watch for the post-login redirect, then read the session cookies straight
 * out of Chromium's cookie jar.
 *
 * The harvested cookie string is returned to the renderer in the same form
 * a curl `Cookie:` header would take: `name=value; name2=value2`. Sean uses
 * it as-is. Cookies expire — when Sean gets a 401/redirect-to-login, he
 * tells the user to open this flow again.
 *
 * This window uses an isolated session partition so the user's regular
 * browser data is untouched, and so closing/clearing the partition wipes
 * the credentials cleanly when the user disables the connector.
 */
import { BrowserWindow, session } from 'electron';

export interface VismaCookieInput {
  /** School subdomain, e.g. "oslo.inschool.visma.no" — no scheme. */
  school: string;
}

export interface VismaCookieResult {
  ok: boolean;
  cookie?: string;
  error?: string;
}

const PARTITION = 'persist:visma-inschool';
const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Cookies whose presence reliably signals a logged-in InSchool session.
 * If the harvest sees ANY of these set with a non-empty value, we treat
 * the user as logged in and capture every cookie we have for the host.
 */
const LOGIN_INDICATORS = ['JSESSIONID', 'XSRF-TOKEN', 'inschool-auth'];

export async function captureVismaCookie(
  input: VismaCookieInput,
): Promise<VismaCookieResult> {
  const school = input.school.trim().replace(/^https?:\/\//, '');
  if (!school || school.includes('/')) {
    return { ok: false, error: 'invalid_school' };
  }
  const baseUrl = `https://${school}`;

  return new Promise<VismaCookieResult>((resolve) => {
    const ses = session.fromPartition(PARTITION, { cache: true });
    const win = new BrowserWindow({
      width: 980,
      height: 760,
      title: 'Logg inn på Visma InSchool',
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    const finish = (result: VismaCookieResult) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      try {
        win.removeAllListeners();
      } catch {
        // ignore
      }
      try {
        if (!win.isDestroyed()) win.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    /**
     * Polls the session's cookie jar for the school host. When at least one
     * login-indicator cookie is set, harvest every cookie and resolve.
     */
    async function checkCookies(): Promise<boolean> {
      try {
        const cookies = await ses.cookies.get({ url: baseUrl });
        const hasIndicator = cookies.some(
          (c) => LOGIN_INDICATORS.includes(c.name) && c.value && c.value.length > 0,
        );
        if (!hasIndicator) return false;
        const formatted = cookies
          .filter((c) => c.value && c.value.length > 0)
          .map((c) => `${c.name}=${c.value}`)
          .join('; ');
        finish({ ok: true, cookie: formatted });
        return true;
      } catch (err) {
        finish({ ok: false, error: (err as Error).message });
        return true;
      }
    }

    win.webContents.on('did-navigate', () => {
      void checkCookies();
    });
    win.webContents.on('did-navigate-in-page', () => {
      void checkCookies();
    });
    win.webContents.on('did-finish-load', () => {
      // Some logins update cookies via XHR after the redirect; poll once
      // more 1.5s after the page finishes loading to catch those.
      setTimeout(() => void checkCookies(), 1_500);
    });

    win.on('closed', () => {
      if (!settled) finish({ ok: false, error: 'cancelled' });
    });

    timeoutHandle = setTimeout(() => {
      finish({ ok: false, error: 'timeout' });
    }, TIMEOUT_MS);

    void win.loadURL(baseUrl);
  });
}
