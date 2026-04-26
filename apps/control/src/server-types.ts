// AUTHORITATIVE source for SSE & API contracts shared with apps/control.
// scripts/sync-control-types.ts mirrors this file into apps/control/src/server-types.ts.

export type SseEvent =
  | { event: 'thinking'; data: { at: number } }
  | { event: 'session'; data: { claudeSessionId: string; controlSessionId: string } }
  | { event: 'partial'; data: { text: string } }
  | { event: 'tool'; data: { name: string; input?: string; output?: string; status: 'running' | 'done' } }
  | { event: 'done'; data: { durationMs: number; costUsdInformational: number; isError: boolean } }
  | { event: 'error'; data: { message: string; retryAfterMs?: number } }
  | { event: 'heartbeat'; data: Record<string, never> };

export type ClaudeModelId =
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5';

export interface ControlMessageRequest {
  controlSessionId: string | null;
  text: string;
  attachments?: Array<{ fileId: string; workspacePath: string; filename: string }>;
  model?: ClaudeModelId;
}

export interface HealthzResponse {
  status: 'ok' | 'degraded';
  authMode: 'subscription';
  db: 'ok' | 'error';
  uptimeSec: number;
  recentMessageCount: number | null;
  service: 'nordrise-ai';
}

export interface ControlSessionSummary {
  id: string;
  title: string | null;
  claudeSessionId: string | null;
  createdAt: string;
  lastActiveAt: string;
  archivedAt: string | null;
}

export interface ControlMessageRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  durationMs: number | null;
  source: 'desktop' | 'telegram';
}
