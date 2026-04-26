'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ControlSessionSummary, ReactionValue } from '../../src/server-types';
import type { ThreadState } from '../state/thread';
import { Message } from './Message';
import { Composer, type ComposerAttachment } from './Composer';
import { DropZone } from './DropZone';
import { uploadFile } from '../lib/api';
import { type AppSettings, modelLabel } from '../lib/settings';
import { ThreadSettingsModal } from './ThreadSettingsModal';

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
  /**
   * Toggle a 👍/👎 reaction on an assistant message. Parent owns the
   * optimistic update (so UI flips instantly) AND the persistence call.
   * `next === null` clears the reaction.
   */
  onReact?: (messageId: string, next: ReactionValue | null) => void;
  /**
   * Called when the user changes the per-thread system prompt via the
   * settings modal. The parent should refresh its session list so the
   * "✨ Custom prompt"-chip stays in sync after navigation.
   */
  onSystemPromptChanged?: (sessionId: string, next: string | null) => void;
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
  onReact,
  onSystemPromptChanged,
}: ChatPaneProps) {
  const [draftText, setDraftText] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [threadSettingsOpen, setThreadSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasCustomPrompt = !!knownSession?.systemPrompt;

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
        // Reaction is only persisted on server messages — drafts haven't
        // earned an id yet so they can't carry one.
        reaction: m.reaction ?? null,
        content: m.content,
        createdAt: m.createdAt,
        source: m.source,
        streaming: false,
        thinking: false,
        error: null as string | null,
        isPersisted: true,
      })),
      ...state.drafts.map((d) => ({
        kind: d.kind,
        id: d.id,
        reaction: null as ReactionValue | null,
        content: d.content,
        createdAt: d.createdAt,
        source: 'desktop' as const,
        streaming: d.kind === 'assistant' ? d.streaming : false,
        thinking: d.kind === 'assistant' ? d.thinking : false,
        error: d.kind === 'assistant' ? d.error ?? null : null,
        isPersisted: false,
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
              {hasCustomPrompt && (
                <span
                  className="connector-chip thread-prompt-chip"
                  title={
                    knownSession?.systemPrompt
                      ? `Tråd-spesifikk system-prompt:\n${knownSession.systemPrompt.slice(0, 240)}${knownSession.systemPrompt.length > 240 ? '…' : ''}`
                      : 'Tråd-spesifikk system-prompt aktiv'
                  }
                >
                  <span aria-hidden="true">✨</span>
                  Custom prompt
                </span>
              )}
              <button
                type="button"
                className="thread-settings-btn"
                onClick={() => setThreadSettingsOpen(true)}
                title="Tråd-innstillinger"
                aria-label="Tråd-innstillinger"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>

        <div className="message-list" ref={scrollRef}>
          {loading && state.serverMessages.length === 0 && (
            <div className="pane-empty pane-skeleton">
              <div className="skeleton skeleton-line" style={{ width: '50%' }} />
              <div className="skeleton skeleton-line" style={{ width: '70%' }} />
              <div className="skeleton skeleton-line" style={{ width: '40%' }} />
            </div>
          )}
          {loadError && (
            <div className="pane-empty pane-error">
              Kunne ikke hente meldinger: {loadError}
            </div>
          )}
          {!loading && !loadError && displayMessages.length === 0 && (
            <div className="pane-empty pane-welcome animate-in">
              <div className="welcome-orb" aria-hidden="true">
                <span>S</span>
              </div>
              <div className="pane-welcome-title">
                {sessionId ? 'Si noe til Sean' : 'Velg en tråd eller start ny'}
              </div>
              <div className="pane-welcome-sub">
                {sessionId
                  ? 'Skriv en melding nedenfor — eller dra og slipp en fil for å legge den ved.'
                  : 'Trykk + Ny i venstre kolonne, eller skriv direkte i komposisjonsfeltet.'}
              </div>
              {!sessionId && (
                <div className="pane-welcome-hint">
                  <kbd>Ctrl</kbd>+<kbd>K</kbd> for hurtig-oppgaver
                </div>
              )}
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
              reaction={m.reaction}
              {...(m.isPersisted ? { messageId: m.id } : {})}
              {...(onReact ? { onReact } : {})}
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
          onFiles={handleFiles}
        />
      </div>
      {sessionId && threadSettingsOpen && (
        <ThreadSettingsModal
          open={threadSettingsOpen}
          onClose={() => setThreadSettingsOpen(false)}
          sessionId={sessionId}
          threadTitle={title}
          currentPrompt={knownSession?.systemPrompt ?? null}
          onSaved={(next) => {
            // Tell AppShell so the session list can re-fetch and the chip
            // reflects the new state immediately. We DON'T update local
            // state — knownSession comes from the parent.
            onSystemPromptChanged?.(sessionId, next);
          }}
        />
      )}
    </DropZone>
  );
}
