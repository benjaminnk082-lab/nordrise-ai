'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ControlSessionSummary } from '../../src/server-types';
import type { ThreadState } from '../state/thread';
import { Message } from './Message';
import { Composer, type ComposerAttachment } from './Composer';
import { DropZone } from './DropZone';
import { uploadFile } from '../lib/api';

export interface ReadyAttachment {
  fileId: string;
  workspacePath: string;
  filename: string;
}

export interface ChatPaneProps {
  sessionId: string | null;
  knownSession?: ControlSessionSummary | null;
  state: ThreadState;
  loading: boolean;
  loadError: string | null;
  onSubmit: (text: string, attachments: ReadyAttachment[]) => void;
  onAbort: () => void;
}

function genLocalId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
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

  const handleFiles = useCallback((files: File[]) => {
    for (const file of files) {
      const localId = genLocalId();
      setAttachments((prev) => [
        ...prev,
        { localId, filename: file.name, status: 'uploading' },
      ]);
      void (async () => {
        try {
          const r = await uploadFile(file);
          setAttachments((prev) =>
            prev.map((a) =>
              a.localId === localId
                ? {
                    ...a,
                    status: 'ready',
                    fileId: r.fileId,
                    workspacePath: r.workspacePath,
                    filename: r.filename || a.filename,
                  }
                : a,
            ),
          );
        } catch (err) {
          setAttachments((prev) =>
            prev.map((a) =>
              a.localId === localId
                ? { ...a, status: 'error', error: String((err as Error).message) }
                : a,
            ),
          );
        }
      })();
    }
  }, []);

  const handleRemove = useCallback((localId: string) => {
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
  }, []);

  function handleSubmit() {
    const text = draftText.trim();
    const ready: ReadyAttachment[] = attachments
      .filter((a): a is ComposerAttachment & { fileId: string; workspacePath: string } =>
        a.status === 'ready' && !!a.fileId && !!a.workspacePath,
      )
      .map((a) => ({
        fileId: a.fileId,
        workspacePath: a.workspacePath,
        filename: a.filename,
      }));
    if (state.streaming) return;
    if (!text && ready.length === 0) return;
    onSubmit(text, ready);
    setDraftText('');
    setAttachments([]);
  }

  const title = knownSession?.title?.trim() || (sessionId ? 'Tråd' : 'Ny samtale');

  return (
    <DropZone onFiles={handleFiles} disabled={state.streaming}>
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
              <div style={{ fontSize: 12, color: 'rgba(244,244,247,0.4)' }}>
                Tips: dra og slipp en fil for å legge den ved.
              </div>
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
          attachments={attachments}
          onRemoveAttachment={handleRemove}
        />
      </div>
    </DropZone>
  );
}
