'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ControlSessionSummary } from '../../src/server-types';
import { listMessages, listSessions, newSession } from '../lib/api';
import { useThreadState } from '../state/thread';
import { useStream } from '../hooks/useStream';
import { ThreadList, type ActiveSelection } from './ThreadList';
import { ChatPane, type ReadyAttachment } from './ChatPane';
import { ThinkingPanel } from './ThinkingPanel';
import { TelegramHistory } from './TelegramHistory';
import { QuickTaskPalette } from './QuickTaskPalette';
import { QuickTaskManager } from './QuickTaskManager';
import { SettingsModal } from './SettingsModal';
import { RoutinesPill } from './RoutinesPill';
import { quitAndInstall, getPendingUpdate } from '../lib/bridge';
import {
  settingsApi,
  ollamaApi,
  buildConnectorKeys,
  DEFAULT_SETTINGS,
  type AppSettings,
} from '../lib/settings';
import { pickModel } from '../lib/routing';

export interface AppShellProps {
  version: string;
  pendingUpdate: string | null;
  onLogout: () => void | Promise<void>;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function AppShell({ version, pendingUpdate, onLogout }: AppShellProps) {
  const [sessions, setSessions] = useState<ControlSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [active, setActive] = useState<ActiveSelection>({ kind: 'new' });
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  // The renderer hydrates this once on mount from the main-process cache so
  // the banner appears even if the `app:update-downloaded` push event fired
  // before the renderer was listening (e.g. during the initial check on boot).
  const [updateReady, setUpdateReady] = useState<{ version: string } | null>(
    pendingUpdate ? { version: pendingUpdate } : null,
  );

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ollamaAvailable, setOllamaAvailable] = useState(false);

  // Hydrate settings on mount, and re-detect Ollama whenever the host /
  // enabled flag changes so the routing heuristic can react.
  useEffect(() => {
    void settingsApi.get().then(setSettings);
  }, []);

  useEffect(() => {
    if (!settings.ollamaEnabled) {
      setOllamaAvailable(false);
      return;
    }
    let cancelled = false;
    void ollamaApi.detect(settings.ollamaHost).then((r) => {
      if (!cancelled) setOllamaAvailable(r.ok);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.ollamaEnabled, settings.ollamaHost]);

  useEffect(() => {
    const off = window.nordrise.on('app:update-downloaded', (info: unknown) => {
      const v = (info as { version?: string } | undefined)?.version;
      if (v) setUpdateReady({ version: v });
    });
    // Belt-and-suspenders hydrate from cache on mount.
    void getPendingUpdate().then((v) => {
      if (v) setUpdateReady((prev) => prev ?? { version: v });
    });
    return () => {
      off();
    };
  }, []);

  const {
    state,
    loadServer,
    send,
    onThinking,
    onPartial,
    onTool,
    onDone,
    onError,
    resetDrafts,
  } = useThreadState();

  const activeAssistantId = useRef<string | null>(null);
  const newSessionIdRef = useRef<string | null>(null);

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const list = await listSessions();
      setSessions(list);
    } catch (err) {
      console.warn('listSessions failed', err);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const refreshMessages = useCallback(
    async (sid: string) => {
      setMessagesLoading(true);
      setMessagesError(null);
      try {
        const rows = await listMessages(sid);
        loadServer(rows);
      } catch (e) {
        setMessagesError(String((e as Error).message));
      } finally {
        setMessagesLoading(false);
      }
    },
    [loadServer],
  );

  // Initial sessions fetch.
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // When the active selection changes, fetch messages (or clear).
  useEffect(() => {
    if (active.kind === 'session') {
      void refreshMessages(active.id);
    } else {
      loadServer([]);
      resetDrafts();
    }
  }, [active, refreshMessages, loadServer, resetDrafts]);

  const stream = useStream({
    onSession: (_claudeSessionId, controlSessionId) => {
      if (active.kind !== 'session') {
        newSessionIdRef.current = controlSessionId;
      }
    },
    onThinking: () => onThinking(),
    onPartial: (chunk) => {
      if (activeAssistantId.current) onPartial(activeAssistantId.current, chunk);
    },
    onTool: (tool) => onTool(tool),
    onDone: () => onDone(),
    onError: (msg) => onError(msg),
    onComplete: () => {
      const sid =
        active.kind === 'session' ? active.id : newSessionIdRef.current;
      if (sid) {
        // Refresh sessions list (title may have updated) and the message
        // history for the active thread, then drop optimistic drafts.
        void refreshSessions();
        void refreshMessages(sid).then(() => {
          resetDrafts();
          if (active.kind !== 'session' && newSessionIdRef.current) {
            const newId = newSessionIdRef.current;
            newSessionIdRef.current = null;
            setActive({ kind: 'session', id: newId });
          }
        });
      } else {
        resetDrafts();
      }
      activeAssistantId.current = null;
    },
  });

  const handleSubmit = useCallback(
    (text: string, attachments: ReadyAttachment[]) => {
      const userId = newId('u');
      const assistantId = newId('a');
      activeAssistantId.current = assistantId;
      // Decorate the user-bubble with a small indicator when files are attached.
      const decoratedText = attachments.length
        ? `${text}${text ? '\n\n' : ''}_(${attachments.length} fil${
            attachments.length === 1 ? '' : 'er'
          } vedlagt: ${attachments.map((a) => a.filename).join(', ')})_`
        : text;
      send(userId, assistantId, decoratedText, new Date().toISOString());

      const sessionId = active.kind === 'session' ? active.id : null;
      const perThread =
        sessionId && settings.perThreadModel[sessionId]
          ? settings.perThreadModel[sessionId]!
          : settings.defaultModel;
      const routed =
        perThread === 'auto'
          ? pickModel({
              text,
              hasAttachments: attachments.length > 0,
              defaultModel: 'auto',
              ollamaAvailable,
              ollamaModel: settings.ollamaModel,
              preferOllamaForSimple: settings.preferOllamaForSimple,
            })
          : perThread;

      // Only forward connector keys if Sean (claude-code) will run — Ollama
      // sub-stream bypasses Sean entirely and there's no MCP integration there.
      const isOllama = typeof routed === 'string' && routed.startsWith('ollama:');
      const connectorKeys = isOllama ? undefined : buildConnectorKeys(settings);

      stream.start({
        controlSessionId: sessionId,
        text,
        attachments: attachments.length ? attachments : undefined,
        ...(routed ? { model: routed } : {}),
        ...(connectorKeys ? { connectorKeys } : {}),
      });
    },
    [active, send, stream, settings, ollamaAvailable],
  );

  const handleAbort = useCallback(() => {
    stream.abort();
    onError('avbrutt');
  }, [stream, onError]);

  // Ctrl+K opens the quick-task palette anywhere in the shell.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handlePalettePick = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      // Fire directly through the same path as Composer submit. Empty
      // attachments — clipboard-attach is a future hook (the QuickTask flag
      // is persisted but not yet wired into the send path).
      handleSubmit(text, []);
    },
    [handleSubmit],
  );

  const handleNew = useCallback(async () => {
    try {
      const s = await newSession();
      setSessions((prev) => [s, ...prev.filter((p) => p.id !== s.id)]);
      setActive({ kind: 'session', id: s.id });
    } catch (err) {
      // Fallback: just go to "new conversation" mode (sessionId=null), let
      // first message create the session implicitly via /control/message.
      console.warn('newSession failed, falling back to inline creation', err);
      setActive({ kind: 'new' });
    }
  }, []);

  const knownSession = useMemo(() => {
    if (active.kind !== 'session') return null;
    return sessions.find((s) => s.id === active.id) ?? null;
  }, [active, sessions]);

  return (
    <div className="shell-frame-wrap">
      <div className="shell-frame">
        {updateReady && (
          <div className="update-banner" role="status">
            <div className="update-banner-text">
              <span className="update-banner-title">
                Versjon {updateReady.version} er klar
              </span>
              <span className="update-banner-sub">
                Relaunch for å installere oppdateringen.
              </span>
            </div>
            <button
              type="button"
              className="update-banner-btn"
              onClick={() => void quitAndInstall()}
            >
              Relaunch nå
            </button>
          </div>
        )}

        <div className="shell-grid">
          <ThreadList
            sessions={sessions}
            active={active}
            onSelect={setActive}
            onNew={() => void handleNew()}
            loading={sessionsLoading}
            onAfterMutate={() => void refreshSessions()}
            onArchived={(sid) => {
              if (active.kind === 'session' && active.id === sid) {
                setActive({ kind: 'new' });
              }
            }}
          />

          {active.kind === 'telegram' ? (
            <TelegramHistory />
          ) : (
            <ChatPane
              sessionId={active.kind === 'session' ? active.id : null}
              knownSession={knownSession}
              state={state}
              loading={messagesLoading}
              loadError={messagesError}
              onSubmit={handleSubmit}
              onAbort={handleAbort}
              settings={settings}
              ollamaAvailable={ollamaAvailable}
              onChangeThreadModel={async (sid, modelId) => {
                const next = await settingsApi.set({
                  perThreadModel: { ...settings.perThreadModel, [sid]: modelId },
                });
                setSettings(next);
              }}
            />
          )}

          {active.kind !== 'telegram' && (
            <ThinkingPanel tools={state.toolCalls} streaming={state.streaming} />
          )}
        </div>

        <div className="shell-foot">
          <span className="status-pill">
            <span className="status-dot online" />
            Sean online
          </span>
          <span className="shell-foot-meta">
            v{version || '?'}
            {updateReady && (
              <span className="shell-foot-update">
                · oppdatering {updateReady.version} klar
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="link-button"
          >
            Quick-tasks
          </button>
          <RoutinesPill />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="link-button"
          >
            Innstillinger
          </button>
          <button type="button" onClick={() => void onLogout()} className="link-button">
            Logg ut
          </button>
        </div>
      </div>

      <QuickTaskPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={handlePalettePick}
        onOpenManage={() => setManagerOpen(true)}
      />
      <QuickTaskManager
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSettingsChange={setSettings}
        version={version}
        onLogout={onLogout}
      />
    </div>
  );
}
