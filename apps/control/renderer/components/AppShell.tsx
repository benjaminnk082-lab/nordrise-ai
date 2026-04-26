'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ControlSessionSummary } from '../../src/server-types';
import { listMessages, listSessions, newSession } from '../lib/api';
import { useThreadState } from '../state/thread';
import { useStream } from '../hooks/useStream';
import { ThreadList, type ActiveSelection } from './ThreadList';
import { ChatPane } from './ChatPane';
import { ThinkingPanel } from './ThinkingPanel';
import { TelegramHistory } from './TelegramHistory';

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
    (text: string) => {
      const userId = newId('u');
      const assistantId = newId('a');
      activeAssistantId.current = assistantId;
      send(userId, assistantId, text, new Date().toISOString());
      stream.start({
        controlSessionId: active.kind === 'session' ? active.id : null,
        text,
      });
    },
    [active, send, stream],
  );

  const handleAbort = useCallback(() => {
    stream.abort();
    onError('avbrutt');
  }, [stream, onError]);

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
        <div className="shell-grid">
          <ThreadList
            sessions={sessions}
            active={active}
            onSelect={setActive}
            onNew={() => void handleNew()}
            loading={sessionsLoading}
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
            {pendingUpdate && (
              <span className="shell-foot-update">
                · oppdatering {pendingUpdate} klar
              </span>
            )}
          </span>
          <button type="button" onClick={() => void onLogout()} className="link-button">
            Logg ut
          </button>
        </div>
      </div>
    </div>
  );
}
