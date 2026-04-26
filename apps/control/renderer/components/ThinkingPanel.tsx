'use client';
import { useState } from 'react';
import type { ToolCall } from '../state/thread';

export interface ThinkingPanelProps {
  tools: ToolCall[];
  streaming: boolean;
}

export function ThinkingPanel({ tools, streaming }: ThinkingPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside className="thinking-rail thinking-rail-collapsed">
        <button
          type="button"
          className="thinking-toggle"
          onClick={() => setCollapsed(false)}
          title="Vis tankerekke"
        >
          <span className="thinking-toggle-glyph">‹</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="thinking-rail">
      <div className="thinking-rail-head">
        <span className="thinking-rail-title">
          Tankerekke
          {streaming && <span className="status-dot online" style={{ marginLeft: 8 }} />}
        </span>
        <button
          type="button"
          className="thinking-toggle"
          onClick={() => setCollapsed(true)}
          title="Skjul tankerekke"
        >
          <span className="thinking-toggle-glyph">›</span>
        </button>
      </div>

      <div className="tool-list">
        {tools.length === 0 && (
          <div className="tool-empty">
            {streaming
              ? 'Sean tenker — verktøy vises her etter hvert…'
              : 'Ingen verktøyskall i denne meldingen.'}
          </div>
        )}
        {tools.map((t) => (
          <div key={t.id} className={`tool-card tool-${t.status}`}>
            <div className="tool-head">
              <span
                className={`tool-status-dot ${t.status === 'running' ? 'pulsing' : 'done'}`}
              />
              <span className="tool-name">{t.name}</span>
              <span className="tool-status-label">
                {t.status === 'running' ? 'kjører' : 'ferdig'}
              </span>
            </div>
            {t.input && <pre className="tool-payload tool-input">{t.input}</pre>}
            {t.output && t.status === 'done' && (
              <pre className="tool-payload tool-output">{t.output}</pre>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
