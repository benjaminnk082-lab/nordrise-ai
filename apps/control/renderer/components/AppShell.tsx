'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ControlSessionSummary, ReactionValue } from '../../src/server-types';
import {
  listMessages,
  listSessions,
  newSession,
  setReaction,
  clearReaction,
  togglePin,
  listPinned,
} from '../lib/api';
import { useThreadState } from '../state/thread';
import { useStream } from '../hooks/useStream';
import { ThreadList, type ActiveSelection } from './ThreadList';
import { ChatPane, type ReadyAttachment } from './ChatPane';
import { ThinkingPanel } from './ThinkingPanel';
import { TelegramHistory } from './TelegramHistory';
import { QuickTaskManager } from './QuickTaskManager';
import { CommandPalette } from './CommandPalette';
import type { ConnectorKey } from './ConnectorRail';
import { PermissionModePill } from './PermissionModePill';
import { SettingsModal } from './SettingsModal';
import { RoutinesPill } from './RoutinesPill';
import { SuggestionsPill } from './SuggestionsPill';
import { SeanNotesPanel } from './SeanNotesPanel';
import { SeanStatusPill } from './SeanStatusPill';
import { GlobalSearch } from './GlobalSearch';
import { PinnedPanel } from './PinnedPanel';
import { Titlebar } from './Titlebar';
import { StatusBar } from './StatusBar';
import { HealthPill } from './HealthPill';
import { VaultSetupCard } from './VaultSetupCard';
import { CostsPanel } from './CostsPanel';
import { vaultApi } from '../lib/vault';
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
  const [settingsFocus, setSettingsFocus] = useState<
    'general' | 'connectors' | null
  >(null);
  const [connectorFocus, setConnectorFocus] = useState<ConnectorKey | null>(
    null,
  );
  const [seanNotesOpen, setSeanNotesOpen] = useState(false);
  const [seanNotesCount, setSeanNotesCount] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false);
  const [pinnedCount, setPinnedCount] = useState(0);

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

  // Poll Sean's pending-notes count every 30s so the footer pill nudges
  // the user when something new shows up. Skips polling if vault sync is off
  // (no notes will appear) or if the document isn't visible.
  useEffect(() => {
    if (!settings.vault.enabled) {
      setSeanNotesCount(0);
      return;
    }
    let cancelled = false;
    async function refresh() {
      if (document.hidden) return;
      try {
        const list = await vaultApi.listSeanNotes();
        if (!cancelled) setSeanNotesCount(list.length);
      } catch {
        // ignore — pill stays at last known value
      }
    }
    void refresh();
    const t = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [settings.vault.enabled]);

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
    setReactionLocal,
    setPinnedLocal,
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

      // Permission policy — Sean's backend appends a system-prompt fragment
      // when mode != 'auto'. Skip for Ollama (no Sean involved).
      const mode = settings.permissionMode ?? 'auto';
      const permissionPayload =
        !isOllama && mode !== 'auto'
          ? {
              permissionMode: mode,
              ...(mode === 'custom'
                ? { effectivePermissions: settings.permissions }
                : {}),
            }
          : {};

      stream.start({
        controlSessionId: sessionId,
        text,
        attachments: attachments.length ? attachments : undefined,
        ...(routed ? { model: routed } : {}),
        ...(connectorKeys ? { connectorKeys } : {}),
        ...permissionPayload,
      });
    },
    [active, send, stream, settings, ollamaAvailable],
  );

  const handleAbort = useCallback(() => {
    stream.abort();
    onError('avbrutt');
  }, [stream, onError]);

  // Regenerate the last assistant reply by re-sending the last user message.
  // We don't delete the previous assistant message — it stays in history so
  // the user can compare. Pure client-side: same code path as handleSubmit.
  const handleRegenerate = useCallback(
    (text: string) => {
      if (state.streaming) return;
      if (!text.trim()) return;
      handleSubmit(text, []);
    },
    [state.streaming, handleSubmit],
  );

  const handleReact = useCallback(
    (messageId: string, next: ReactionValue | null) => {
      // Optimistic local update so the bubble flips instantly. The persist
      // call is fire-and-forget — if it fails the user can re-click and
      // we'll retry with the same upsert semantics.
      setReactionLocal(messageId, next);
      void (async () => {
        try {
          if (next === null) await clearReaction(messageId);
          else await setReaction(messageId, next);
        } catch (err) {
          console.warn('reaction persist failed', err);
        }
      })();
    },
    [setReactionLocal],
  );

  // Toggle pin — optimistic flip, then server reads true value and we sync.
  const refreshPinnedCount = useCallback(async () => {
    try {
      const list = await listPinned();
      setPinnedCount(list.length);
    } catch {
      // Silently ignore — pill stays at last known value.
    }
  }, []);

  const handleTogglePin = useCallback(
    (messageId: string) => {
      // Find current state in serverMessages so we know what to optimistically
      // set. If the message isn't tracked locally (e.g. user clicked from
      // pinned panel), we just dispatch without a flip — the server reply
      // will tell us the truth.
      const target = state.serverMessages.find((m) => m.id === messageId);
      const next = target ? !target.pinned : true;
      setPinnedLocal(messageId, next);
      void (async () => {
        try {
          const r = await togglePin(messageId);
          if (target && r.pinned !== next) {
            setPinnedLocal(messageId, r.pinned);
          }
        } catch (err) {
          console.warn('pin toggle failed', err);
          if (target) setPinnedLocal(messageId, !next); // rollback
        } finally {
          void refreshPinnedCount();
        }
      })();
    },
    [setPinnedLocal, state.serverMessages, refreshPinnedCount],
  );

  const handleSystemPromptChanged = useCallback(
    (sid: string, next: string | null) => {
      // Apply the change locally so the chip updates without waiting for
      // the round-trip, then refresh the canonical session list.
      setSessions((prev) =>
        prev.map((s) => (s.id === sid ? { ...s, systemPrompt: next } : s)),
      );
      void refreshSessions();
    },
    [refreshSessions],
  );

  // Ctrl+K opens the quick-task palette; Ctrl+F opens the global search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Initial pinned-count load + light poll so the footer pill matches the
  // server. We use 60s; this is a low-volume signal, no need to hammer.
  useEffect(() => {
    void refreshPinnedCount();
    const t = setInterval(() => void refreshPinnedCount(), 60_000);
    return () => clearInterval(t);
  }, [refreshPinnedCount]);

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

  const openConnectorsSettings = useCallback((focusKey?: ConnectorKey) => {
    setSettingsFocus('connectors');
    setConnectorFocus(focusKey ?? null);
    setSettingsOpen(true);
  }, []);

  const handleToggleConnector = useCallback(
    async (
      name: 'firecrawl' | 'github' | 'vercel' | 'teams' | 'itslearning' | 'visma',
      next: boolean,
    ) => {
      const patch = {
        connectors: {
          ...settings.connectors,
          [name]: { ...settings.connectors[name], enabled: next },
        },
      };
      const updated = await settingsApi.set(patch);
      setSettings(updated);
    },
    [settings.connectors],
  );

  const handleChangePermissionMode = useCallback(
    async (next: 'auto' | 'manual' | 'custom') => {
      const updated = await settingsApi.set({ permissionMode: next });
      setSettings(updated);
    },
    [],
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

  // Phase 3 — vault setup modal opens when the user has no vault path
  // configured (or hits the "set up vault" CTA from the status bar).
  const [vaultSetupOpen, setVaultSetupOpen] = useState(false);
  const [costsOpen, setCostsOpen] = useState(false);

  // Theme toggle — flips between dark and light only (the other named themes
  // remain reachable from Settings → Generelt). Persisted via settings:set so
  // it survives restarts. We apply optimistically because ThemeApplier is
  // listening on the same setting and will re-apply on next render anyway.
  const handleToggleTheme = useCallback(() => {
    const current = settings.theme ?? 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    void settingsApi.set({ theme: next }).then(setSettings);
  }, [settings.theme]);

  // Pretty model name for the StatusBar. Uses defaultModel; per-thread
  // override is shown via the existing chip in ChatPane, not here.
  const modelLabel = (() => {
    const m = settings.defaultModel ?? 'auto';
    if (m === 'auto') return 'Auto';
    if (m === 'claude-opus-4-7') return 'Opus 4.7';
    if (m === 'claude-sonnet-4-6') return 'Sonnet 4.6';
    if (m === 'claude-haiku-4-5') return 'Haiku 4.5';
    return m;
  })();

  return (
    <div className="shell-frame-wrap">
      <div className="shell-frame">
        <Titlebar
          settings={settings}
          onOpenConnectors={openConnectorsSettings}
          onNewThread={() => void handleNew()}
          onOpenSettings={() => {
            setSettingsFocus('general');
            setSettingsOpen(true);
          }}
          onToggleTheme={handleToggleTheme}
          themeMode={settings.theme ?? 'dark'}
        />

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
          <div className="shell-sidebar">
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
            <div className="sb-presence" role="contentinfo">
              <span className="sb-presence-avatar" aria-hidden="true">B</span>
              <span className="sb-presence-name">Benjamin</span>
              <button
                type="button"
                onClick={() => void onLogout()}
                className="link-button"
                style={{ marginLeft: 'auto', fontSize: 11 }}
                title="Logg ut"
              >
                ⏻
              </button>
            </div>
          </div>

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
              onReact={handleReact}
              onTogglePin={handleTogglePin}
              onRegenerate={handleRegenerate}
              onSystemPromptChanged={handleSystemPromptChanged}
            />
          )}

          {active.kind !== 'telegram' && (
            <ThinkingPanel tools={state.toolCalls} streaming={state.streaming} />
          )}
        </div>

        <div className="shell-foot">
          <PermissionModePill
            mode={settings.permissionMode ?? 'auto'}
            onChange={(m) => void handleChangePermissionMode(m)}
          />
          <SeanStatusPill />
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="link-button"
          >
            Quick-tasks
          </button>
          <RoutinesPill />
          <SuggestionsPill />
          <button
            type="button"
            onClick={() => setPinnedPanelOpen(true)}
            className="link-button"
            title="Pinet meldinger"
          >
            Pinet
            {pinnedCount > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: 'var(--surface-active)',
                  color: 'var(--text)',
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                {pinnedCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setGlobalSearchOpen(true)}
            className="link-button"
            title="Søk (Ctrl+F)"
          >
            Søk
          </button>
          <button
            type="button"
            onClick={() => setCostsOpen(true)}
            className="link-button"
            title="Kostnader siste 30 dager"
          >
            Costs
          </button>
          {settings.vault.enabled && (
            <button
              type="button"
              onClick={() => setSeanNotesOpen(true)}
              className="link-button"
              title="Forslag fra Sean"
            >
              Sean&apos;s notater
              {seanNotesCount > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: 'var(--surface-active)',
                    color: 'var(--text)',
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  {seanNotesCount}
                </span>
              )}
            </button>
          )}
        </div>

        <StatusBar
          modelLabel={modelLabel}
          tokens={null}
          costUsd={null}
          version={version || undefined}
          trailing={<HealthPill />}
        />

        {(!settings.vault?.localPath || vaultSetupOpen) && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(4px)',
              zIndex: 200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
            onClick={() => {
              if (settings.vault?.localPath) setVaultSetupOpen(false);
            }}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <VaultSetupCard
                onPicked={async (vaultPath) => {
                  const next = await settingsApi.set({
                    vault: { ...settings.vault, enabled: true, localPath: vaultPath },
                  });
                  setSettings(next);
                  setVaultSetupOpen(false);
                }}
                onCancel={
                  settings.vault?.localPath
                    ? () => setVaultSetupOpen(false)
                    : undefined
                }
              />
            </div>
          </div>
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onAsk={handlePalettePick}
        onPick={handlePalettePick}
        onNewThread={() => void handleNew()}
        onSelectThread={(sid) => setActive({ kind: 'session', id: sid })}
        onOpenSettings={(tab) => {
          setSettingsFocus(tab ?? 'general');
          setSettingsOpen(true);
        }}
        onOpenManageQuickTasks={() => setManagerOpen(true)}
        onOpenSearch={() => setGlobalSearchOpen(true)}
        onOpenPinned={() => setPinnedPanelOpen(true)}
        onOpenSeanNotes={() => setSeanNotesOpen(true)}
        onLogout={onLogout}
        sessions={sessions}
        settings={settings}
        onToggleConnector={handleToggleConnector}
        onChangePermissionMode={handleChangePermissionMode}
      />
      <QuickTaskManager
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsFocus(null);
          setConnectorFocus(null);
        }}
        settings={settings}
        onSettingsChange={setSettings}
        version={version}
        onLogout={onLogout}
        focusSection={settingsFocus}
        focusConnector={connectorFocus}
      />
      <SeanNotesPanel
        open={seanNotesOpen}
        onClose={() => setSeanNotesOpen(false)}
        vaultRoot={settings.vault.localPath}
        onAfterAction={async () => {
          try {
            const list = await vaultApi.listSeanNotes();
            setSeanNotesCount(list.length);
          } catch {
            /* ignore */
          }
        }}
      />
      <GlobalSearch
        open={globalSearchOpen}
        onClose={() => setGlobalSearchOpen(false)}
        vaultRoot={settings.vault.enabled ? settings.vault.localPath : ''}
        onSelectMessage={(controlSessionId, _messageId) => {
          if (controlSessionId) setActive({ kind: 'session', id: controlSessionId });
        }}
      />
      <PinnedPanel
        open={pinnedPanelOpen}
        onClose={() => setPinnedPanelOpen(false)}
        onSelectThread={(controlSessionId) =>
          setActive({ kind: 'session', id: controlSessionId })
        }
      />
      <CostsPanel open={costsOpen} onClose={() => setCostsOpen(false)} />
    </div>
  );
}
