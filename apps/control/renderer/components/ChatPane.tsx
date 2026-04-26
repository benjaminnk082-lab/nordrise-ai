'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ControlSessionSummary } from '../../src/server-types';
import type { ThreadState } from '../state/thread';
import { Message } from './Message';
import { Composer, type ComposerAttachment } from './Composer';
import { DropZone } from './DropZone';
import { uploadFile } from '../lib/api';
import { type AppSettings, modelLabel } from '../lib/settings';

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
  settings: AppSettings;
  ollamaAvailable: boolean;
  /**
   * Persist a per-thread model override. Called with the synthetic id `auto`
   * to clear back to the default heuristic, or with a concrete model id
   * (claude-* or `ollama:<name>`).
   */
  onChangeThreadModel: (sessionId: string, modelId: string) => void | Promise<void>;
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
  settings,
  ollamaAvailable,
  onChangeThreadModel,
}: ChatPaneProps) {
  const [draftText, setDraftText] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Resolve which model is active for the current thread (per-thread override
  // wins over the global default).
  const activeModelId =
    sessionId && settings.perThreadModel[sessionId]
      ? settings.perThreadModel[sessionId]!
      : settings.defaultModel;

  useEffect(() => {
    if (!modelMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest('.model-chip-wrap')) setModelMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [modelMenuOpen]);

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
          <div className="pane-header-main">
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
          {sessionId && (
            <div className="pane-header-chips">
              <div className="model-chip-wrap">
              <button
                type="button"
                className="model-chip"
                onClick={() => setModelMenuOpen((v) => !v)}
                title="Velg modell for denne tråden"
              >
                <span className="model-chip-dot" />
                {modelLabel(activeModelId)}
              </button>
              {modelMenuOpen && (
                <div className="model-chip-menu">
                  {(['auto', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'] as const).map(
                    (id) => (
                      <button
                        key={id}
                        type="button"
                        className={`model-chip-menu-row ${activeModelId === id ? 'model-chip-menu-row-active' : ''}`}
                        onClick={() => {
                          void onChangeThreadModel(sessionId, id);
                          setModelMenuOpen(false);
                        }}
                      >
                        {modelLabel(id)}
                      </button>
                    ),
                  )}
                  {ollamaAvailable && settings.ollamaModel && (
                    <button
                      type="button"
                      className={`model-chip-menu-row ${activeModelId === `ollama:${settings.ollamaModel}` ? 'model-chip-menu-row-active' : ''}`}
                      onClick={() => {
                        void onChangeThreadModel(
                          sessionId,
                          `ollama:${settings.ollamaModel}`,
                        );
                        setModelMenuOpen(false);
                      }}
                    >
                      {modelLabel(`ollama:${settings.ollamaModel}`)}
                    </button>
                  )}
                </div>
              )}
              </div>
              {settings.connectors?.firecrawl?.enabled &&
                settings.connectors.firecrawl.apiKey.trim() && (
                  <span
                    className="connector-chip"
                    title="Firecrawl: web search/scrape aktiv"
                  >
                    <span aria-hidden="true">🌐</span>
                    Firecrawl
                  </span>
                )}
              {settings.connectors?.github?.enabled &&
                settings.connectors.github.token.trim() && (
                  <span
                    className="connector-chip"
                    title="GitHub: issues / PRs / kode-search aktiv"
                  >
                    <span aria-hidden="true">🐙</span>
                    GitHub
                  </span>
                )}
            </div>
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
