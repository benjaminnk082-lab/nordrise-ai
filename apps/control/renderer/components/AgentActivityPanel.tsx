'use client';
import { useEffect, useState, useRef } from 'react';
import type { ToolCall } from '../state/thread';

/**
 * AgentActivityPanel — ClawBro-style real-time view of what Sean is
 * doing. Replaces ThinkingPanel.
 *
 *   ┌─────────────────────────────────┐
 *   │ ▶ Sean works                    │  ← live header (status pulse + elapsed)
 *   │ Step 3 · 12 s elapsed           │
 *   │                                 │
 *   │ ✎ edit src/foo.ts               │  ← currently running tool (highlighted)
 *   │   patches: 4                    │
 *   │                                 │
 *   │ ─── completed ───               │
 *   │ ✓ read prisma/schema.prisma     │  ← past tools (dimmed)
 *   │ ✓ search "TokenUsage"           │
 *   │ ✓ bash npm test                 │
 *   │   (3 passed, 0 failed)          │
 *   └─────────────────────────────────┘
 *
 * Visual hierarchy:
 *  - Running tool gets the loudest treatment (pulsing dot + bold + bg)
 *  - Completed tools collapse into a quieter list, click to expand input/output
 *  - Empty state when idle: "Sean venter på instruksjoner"
 *
 * Built on the existing SSE `tool` events (shape in
 * `src/api/control/types.ts`). No backend changes — the renderer
 * already accumulates these into `state.toolCalls`. We just give
 * them a much better surface.
 */

export interface AgentActivityPanelProps {
  tools: ToolCall[];
  streaming: boolean;
  /** When set, an Abort button is rendered. */
  onAbort?: () => void;
}

function toolGlyph(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('bash') || n.includes('shell')) return '⌨';
  if (n.includes('read') || n.includes('view') || n.includes('cat')) return '📖';
  if (n.includes('write') || n.includes('edit') || n.includes('apply')) return '✎';
  if (n.includes('search') || n.includes('grep') || n.includes('glob')) return '🔍';
  if (n.includes('web') || n.includes('fire') || n.includes('fetch')) return '🌐';
  if (n.includes('git')) return '🐙';
  if (n.includes('telegram')) return '✉';
  if (n.includes('mcp')) return '⊕';
  return '•';
}

function toolPalette(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('write') || n.includes('edit')) return 'edit';
  if (n.includes('bash') || n.includes('shell')) return 'shell';
  if (n.includes('search') || n.includes('grep')) return 'search';
  if (n.includes('web') || n.includes('fetch')) return 'web';
  if (n.includes('read') || n.includes('view')) return 'read';
  if (n.includes('git')) return 'git';
  return 'default';
}

function fmtElapsed(ms: number): string {
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${m} m ${s} s`;
}

export function AgentActivityPanel({
  tools,
  streaming,
  onAbort,
}: AgentActivityPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [openTool, setOpenTool] = useState<string | null>(null);

  // Tick the clock every second so elapsed times update live without
  // touching the reducer state. Runs only while something's actually
  // streaming or there are running tools — idle panels don't burn
  // re-renders.
  const hasRunning = streaming || tools.some((t) => t.status === 'running');
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasRunning]);

  if (collapsed) {
    return (
      <aside className="aap aap-collapsed">
        <button
          type="button"
          className="aap-toggle"
          onClick={() => setCollapsed(false)}
          title="Vis aktivitet"
        >
          <span className="aap-toggle-glyph">‹</span>
          {hasRunning && <span className="aap-collapsed-pulse" aria-hidden="true" />}
        </button>
      </aside>
    );
  }

  const running = tools.filter((t) => t.status === 'running');
  const done = tools.filter((t) => t.status === 'done').reverse(); // newest first
  const startedAt = tools[0]?.startedAt;
  const elapsed = startedAt ? now - startedAt : 0;
  const stepCount = tools.length;

  return (
    <aside className="aap">
      <header className="aap-head">
        <div className="aap-head-row">
          <span className={`aap-status ${hasRunning ? 'is-running' : 'is-idle'}`}>
            <span className="aap-status-dot" aria-hidden="true" />
            <span className="aap-status-label">
              {hasRunning ? 'Sean jobber' : 'Sean venter'}
            </span>
          </span>
          <button
            type="button"
            className="aap-toggle"
            onClick={() => setCollapsed(true)}
            title="Skjul"
          >
            <span className="aap-toggle-glyph">›</span>
          </button>
        </div>
        {hasRunning && (
          <div className="aap-meta">
            <span>
              {stepCount > 0 ? `Steg ${stepCount}` : 'Tenker…'}
            </span>
            {startedAt && (
              <>
                <span className="aap-meta-sep">·</span>
                <span>{fmtElapsed(elapsed)}</span>
              </>
            )}
            {onAbort && (
              <button
                type="button"
                className="aap-abort"
                onClick={onAbort}
                title="Avbryt"
              >
                Avbryt
              </button>
            )}
          </div>
        )}
      </header>

      <div className="aap-list">
        {tools.length === 0 && (
          <Empty streaming={streaming} />
        )}

        {running.map((t) => (
          <ToolRow
            key={t.id}
            tool={t}
            elapsed={now - t.startedAt}
            highlighted
            open={openTool === t.id}
            onToggle={() =>
              setOpenTool(openTool === t.id ? null : t.id)
            }
          />
        ))}

        {running.length > 0 && done.length > 0 && (
          <div className="aap-divider" aria-hidden="true">
            <span>fullført</span>
          </div>
        )}

        {done.map((t) => (
          <ToolRow
            key={t.id}
            tool={t}
            elapsed={0}
            highlighted={false}
            open={openTool === t.id}
            onToggle={() =>
              setOpenTool(openTool === t.id ? null : t.id)
            }
          />
        ))}
      </div>
    </aside>
  );
}

function Empty({ streaming }: { streaming: boolean }) {
  return (
    <div className="aap-empty">
      {streaming ? (
        <>
          <div className="aap-empty-pulse" aria-hidden="true" />
          <div>Sean tenker…</div>
          <div className="aap-empty-sub">
            Verktøy dukker opp her etter hvert som de kjører.
          </div>
        </>
      ) : (
        <>
          <div className="aap-empty-orb" aria-hidden="true" />
          <div>Sean venter på instruksjoner</div>
          <div className="aap-empty-sub">
            Når Sean utfører et oppdrag ser du fremdriften her — hvilke
            verktøy som kjører, hvilke filer som leses, og hvor langt
            han er kommet.
          </div>
        </>
      )}
    </div>
  );
}

function ToolRow({
  tool,
  elapsed,
  highlighted,
  open,
  onToggle,
}: {
  tool: ToolCall;
  elapsed: number;
  highlighted: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const palette = toolPalette(tool.name);
  const hasPayload = !!(tool.input || tool.output);
  return (
    <div
      className={`aap-row aap-row-${palette} ${highlighted ? 'is-running' : 'is-done'} ${open ? 'is-open' : ''}`}
      role={hasPayload ? 'button' : undefined}
      tabIndex={hasPayload ? 0 : undefined}
      onClick={hasPayload ? onToggle : undefined}
      onKeyDown={(e) => {
        if (hasPayload && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="aap-row-head">
        <span className="aap-row-glyph" aria-hidden="true">
          {toolGlyph(tool.name)}
        </span>
        <span className="aap-row-name">{tool.name}</span>
        <span className="aap-row-spacer" />
        {highlighted ? (
          <span className="aap-row-time aap-row-time-live">
            {fmtElapsed(elapsed)}
          </span>
        ) : (
          <span className="aap-row-status-tick" aria-hidden="true">
            ✓
          </span>
        )}
      </div>
      {tool.input && (
        <div className="aap-row-preview">
          <span className="aap-row-preview-label">in</span>
          <code>{open ? tool.input : preview(tool.input, 80)}</code>
        </div>
      )}
      {tool.output && (
        <div className="aap-row-preview">
          <span className="aap-row-preview-label">out</span>
          <code>{open ? tool.output : preview(tool.output, 80)}</code>
        </div>
      )}
    </div>
  );
}

function preview(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= n) return oneLine;
  return oneLine.slice(0, n - 1) + '…';
}
