'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { phase3Preview } from '../lib/bridge';

/**
 * PreviewPanel — slide-in side panel showing a live preview of a local
 * dev server. Uses an `<iframe>` rather than Electron's deprecated
 * `<webview>` or BrowserView; for localhost dev servers this works
 * because dev frameworks don't set X-Frame-Options. Hot-reload "just
 * works" because it's a real browser frame inside the renderer.
 *
 * Toolbar:
 *   - port picker (auto-scans 3000, 5173, 8080, …)
 *   - viewport size selector (mobile 390×844 / tablet 768×1024 / desktop 100%)
 *   - refresh
 *   - open in external browser
 */

export interface PreviewPanelProps {
  open: boolean;
  onClose: () => void;
}

type Viewport = 'mobile' | 'tablet' | 'desktop';

const VIEWPORTS: Record<Viewport, { width: number | string; height: number | string }> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: '100%', height: '100%' },
};

export function PreviewPanel({ open, onClose }: PreviewPanelProps) {
  const [openPorts, setOpenPorts] = useState<number[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [port, setPort] = useState<number | null>(null);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [framework, setFramework] = useState<string>('unknown');
  const [iframeKey, setIframeKey] = useState(0); // force-refresh iframe
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const ports = await phase3Preview.scan({ timeoutMs: 250 });
      setOpenPorts(ports);
      if (port === null && ports.length > 0) setPort(ports[0] ?? null);
    } finally {
      setScanning(false);
    }
  }, [port]);

  useEffect(() => {
    if (open) void scan();
  }, [open, scan]);

  useEffect(() => {
    if (!port) return;
    void phase3Preview.sniff(`http://localhost:${port}`).then(setFramework);
  }, [port]);

  const refresh = useCallback(() => setIframeKey((k) => k + 1), []);

  const openExternal = useCallback(() => {
    if (!port) return;
    window.nordrise.invoke('shell:open-external', `http://localhost:${port}`);
  }, [port]);

  if (!open) return null;

  const v = VIEWPORTS[viewport];

  return (
    <aside
      role="complementary"
      aria-label="Live preview"
      style={{
        position: 'fixed',
        top: 'var(--tb-height)',
        right: 0,
        bottom: 'var(--sb-height)',
        width: 'min(540px, 50vw)',
        background: 'var(--bg-elevated)',
        borderLeft: '1px solid var(--separator)',
        boxShadow: 'var(--shadow-medium)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 30,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: '1px solid var(--separator)',
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>Preview</span>
        <select
          value={port ?? ''}
          onChange={(e) => setPort(Number(e.target.value) || null)}
          style={{
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 6px',
            fontSize: 11,
          }}
        >
          <option value="">— port —</option>
          {(openPorts ?? []).map((p) => (
            <option key={p} value={p}>
              localhost:{p}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="link-button"
          onClick={() => void scan()}
          disabled={scanning}
          title="Skann porter på nytt"
        >
          {scanning ? '…' : '↻'}
        </button>
        <span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>
          {framework !== 'unknown' && `· ${framework}`}
        </span>
        <span style={{ marginLeft: 'auto' }}>
          {(['mobile', 'tablet', 'desktop'] as Viewport[]).map((v) => (
            <button
              key={v}
              type="button"
              className="link-button"
              onClick={() => setViewport(v)}
              style={{
                fontSize: 11,
                marginLeft: 4,
                color: viewport === v ? 'var(--text)' : 'var(--text-faint)',
                fontWeight: viewport === v ? 600 : 400,
              }}
            >
              {v}
            </button>
          ))}
        </span>
        <button type="button" className="link-button" onClick={refresh} title="Last på nytt">
          ↺
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => void openExternal()}
          title="Åpne i nettleser"
        >
          ↗
        </button>
        <button type="button" className="link-button" onClick={onClose} title="Lukk">
          ✕
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          background: 'var(--bg-sunken)',
          display: 'flex',
          alignItems: viewport === 'desktop' ? 'stretch' : 'flex-start',
          justifyContent: 'center',
          padding: viewport === 'desktop' ? 0 : 'var(--space-3)',
        }}
      >
        {port ? (
          <iframe
            ref={iframeRef}
            key={iframeKey}
            src={`http://localhost:${port}`}
            title={`localhost:${port}`}
            style={{
              width: v.width,
              height: v.height,
              maxWidth: '100%',
              maxHeight: '100%',
              border: viewport === 'desktop' ? 0 : '1px solid var(--separator)',
              borderRadius: viewport === 'desktop' ? 0 : 6,
              background: '#fff',
            }}
          />
        ) : (
          <div
            style={{
              padding: 'var(--space-5)',
              color: 'var(--text-muted)',
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            {openPorts === null
              ? 'Skanner…'
              : openPorts.length === 0
                ? 'Ingen dev-server på vanlige porter (3000, 5173, 8080, …). Start dev-serveren og trykk ↻.'
                : 'Velg en port øverst.'}
          </div>
        )}
      </div>
    </aside>
  );
}
