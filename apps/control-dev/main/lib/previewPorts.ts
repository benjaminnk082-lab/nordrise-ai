/**
 * previewPorts — port-detect heuristic for the live website-preview pane.
 *
 * Pure-Node module. The IPC layer in `main/ipc.ts` exposes these via
 * `preview:*` channels (see CLAUDE.md §12); the BrowserView mount lives
 * in `main/preview.ts`.
 *
 * Heuristic: a "likely dev-server port" is one of the well-known dev
 * defaults (Next 3000, Vite 5173, Webpack 8080, …) AND in user-port
 * range (1024-65535). System ports (<1024) are always rejected.
 */
import { Socket } from 'node:net';

const COMMON_DEV_PORTS = [
  3000, // Next, CRA, many Node servers
  3001, // CRA fallback
  4000, // Phoenix, others
  4173, // Vite preview
  4200, // Angular CLI
  5000, // Flask, Astro
  5173, // Vite dev
  5174, // Vite alt
  5500, // VS Code Live Server
  8000, // Django, Python -m http.server
  8080, // Webpack, etc.
  8081, // RN Metro
  8888, // Jupyter
  9000, // PHP -S, others
  4101, // Nordrise Control sandbox renderer
  4001, // Nordrise Control live renderer
];

export function isLikelyDevServerPort(port: number): boolean {
  if (!Number.isInteger(port)) return false;
  if (port < 1024 || port > 65535) return false;
  return COMMON_DEV_PORTS.includes(port);
}

/**
 * Return the dev-server ports that currently accept TCP connects on
 * localhost. Each port is tested independently with a short timeout so
 * the whole scan completes in roughly `timeoutMs` regardless of how
 * many ports are unbound.
 */
export async function scanCommonDevPorts(
  opts: { timeoutMs?: number; host?: string } = {},
): Promise<number[]> {
  const timeoutMs = opts.timeoutMs ?? 250;
  const host = opts.host ?? '127.0.0.1';
  const checks = COMMON_DEV_PORTS.map((p) => probe(host, p, timeoutMs));
  const open = await Promise.all(checks);
  return COMMON_DEV_PORTS.filter((_, i) => open[i]);
}

function probe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new Socket();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        s.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    s.setTimeout(timeoutMs);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, host);
  });
}

/**
 * Sniff the dev-server framework from a localhost URL. Best-effort:
 * fetches the root path, looks for known stamps in the HTML / response
 * headers. Returns `'unknown'` if nothing matches. The IPC layer can
 * surface this as a small label next to the preview iframe.
 */
export async function sniffFramework(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: 'GET' });
    const html = (await res.text()).slice(0, 4096);
    if (/data-reactroot|__NEXT_DATA__/.test(html)) return 'Next';
    if (/<vite-preload|@vite\//.test(html)) return 'Vite';
    if (/window\.__remix/.test(html)) return 'Remix';
    if (/<astro-island/.test(html)) return 'Astro';
    if (/<title>Webpack/.test(html)) return 'Webpack';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
