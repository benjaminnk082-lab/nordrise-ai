'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ControlSessionSummary } from '../../src/server-types';
import type { ThreadState } from '../state/thread';
import { Message } from './Message';
import { Composer } from './Composer';

export interface ChatPaneProps {
  sessionId: string | null;
  knownSession?: ControlSessionSummary | null;
  state: ThreadState;
  loading: boolean;
  loadError: string | null;
  onSubmit: (text: string) => void;
  onAbort: () => void;
}

export function ChatPane({
  sessionId,
  knownSession,
  state,
  loading,
  loadError,
  onSubmit,
  onAbort,
}: ChatPaneProps) {
  const [draftText, setDraftText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const displayMessages = useMemo(() => {
    return [
      ...state.serverMessages.map((m) => ({
        kind: m.role as 'user' | 'assistant' | 'system',
        id: m.id,
        content: m.content,
        createdAt: m.createdAt,
        source: m.source,
        streaming: false,
        thinking: false,
        error: null as string | null,
      })),
      ...state.drafts.map((d) => ({
        kind: d.kind,
        id: d.id,
        content: d.content,
        createdAt: d.createdAt,
        source: 'desktop' as const,
        streaming: d.kind === 'assistant' ? d.streaming : false,
        thinking: d.kind === 'assistant' ? d.thinking : false,
        error: d.kind === 'assistant' ? d.error ?? null : null,
      })),
    ];
  }, [state.serverMessages, state.drafts]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [displayMessages.length, state.drafts]);

  function handleSubmit() {
    const text = draftText.trim();
    if (!text || state.streaming) return;
    onSubmit(text);
    setDraftText('');
  }

  const title = knownSession?.title?.trim() || (sessionId ? 'Tråd' : 'Ny samtale');

  return (
    <div className="chat-pane">
      <div className="pane-header">
        <span className="pane-title">{title}</span>
        {sessionId && (
          <span className="pane-subtitle">
            {state.streaming ? 'Sean svarer…' : 'Klar'}
          </span>
        )}
        {!sessionId && (
          <span className="pane-subtitle">
            Send første melding for å opprette tråden
          </span>
        )}
      </div>

      <div className="message-list" ref={scrollRef}>
        {loading && state.serverMessages.length === 0 && (
          <div className="pane-empty">Henter meldinger…</div>
        )}
        {loadError && (
          <div className="pane-empty pane-error">
            Kunne ikke hente meldinger: {loadError}
          </div>
        )}
        {!loading && !loadError && displayMessages.length === 0 && (
          <div className="pane-empty pane-welcome">
            <div className="welcome-orb" aria-hidden="true">
              <span>S</span>
            </div>
            <div>Spør Sean om ideer, regnskap, kode — hva som helst.</div>
          </div>
        )}
        {displayMessages.map((m) => (
          <Message
            key={m.id}
            role={m.kind}
            content={m.content}
            createdAt={m.createdAt}
            source={m.source}
            streaming={m.streaming}
            thinking={m.thinking}
            error={m.error}
          />
        ))}
      </div>

      <Composer
        value={draftText}
        onChange={setDraftText}
        onSubmit={handleSubmit}
        onAbort={onAbort}
        streaming={state.streaming}
      />
    </div>
  );
}
