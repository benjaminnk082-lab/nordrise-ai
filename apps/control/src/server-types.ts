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
  /**
   * Optional per-user Claude OAuth token (sk-ant-oat01-…). When set, the
   * backend forwards it as `CLAUDE_CODE_OAUTH_TOKEN` into the claude-code
   * spawn env, overriding the server-default token for that one call.
   */
  claudeAuthToken?: string;
}

/**
 * `GET /control/persona` — Sean's live persona prompt. Used by the desktop
 * app to inject Sean's identity via Ollama's `system` parameter when a
 * thread is routed locally (cross-model identity).
 */
export interface PersonaResponse {
  persona: string;
  sha1: string;
  length: number;
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
  /**
   * Per-thread system-prompt override. Appended after the persona via
   * `--append-system-prompt` for every message in this thread. NULL = use
   * persona only.
   */
  systemPrompt: string | null;
}

export type ReactionValue = 'up' | 'down';

export interface ControlMessageRow {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  durationMs: number | null;
  source: 'desktop' | 'telegram';
  /**
   * The user's 👍/👎 reaction on this message, if any. Only populated for
   * assistant messages — clients should ignore reactions on user messages.
   */
  reaction: ReactionValue | null;
}

export type RoutineChannel = 'desktop' | 'telegram' | 'both';
export type RoutineRunStatus = 'running' | 'success' | 'failed';

export interface RoutineSummary {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  channel: RoutineChannel;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  runCount: number;
}

export interface RoutineRunRow {
  id: string;
  routineId: string;
  startedAt: string;
  finishedAt: string | null;
  status: RoutineRunStatus;
  result: string | null;
  errorMsg: string | null;
  durationMs: number | null;
}

export interface RoutineRunRecent extends RoutineRunRow {
  routineName: string;
}

export interface RoutineCreateInput {
  name: string;
  prompt: string;
  schedule: string;
  enabled?: boolean;
  channel?: RoutineChannel;
  model?: ClaudeModelId;
}

export type RoutinePatchInput = Partial<RoutineCreateInput>;

// ---------- Suggestions ----------

export type SuggestionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'done'
  | 'failed'
  | 'expired';

export type SuggestionType =
  | 'research'
  | 'cleanup'
  | 'check'
  | 'remind'
  | 'idea'
  | 'note';

export interface SuggestionSummary {
  id: string;
  type: SuggestionType;
  title: string;
  rationale: string;
  prompt: string;
  status: SuggestionStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  result: string | null;
  errorMsg: string | null;
  durationMs: number | null;
}

export interface SuggestionGenerateResult {
  generated: number;
  skipped: boolean;
  reason?: string;
}

// ---------- Proactive engine ----------

/**
 * Singleton settings row for the proactive engine, mirroring the Prisma
 * `ProactiveSettings` model. Quiet hours: `quietHourStart` inclusive,
 * `quietHourEnd` exclusive (start=22, end=8 → hours 22, 23, 0..7 silent).
 * Cadence is the cron-tick spacing in minutes.
 */
export interface ProactiveSettingsRow {
  id: string;
  enabled: boolean;
  quietHourStart: number;
  quietHourEnd: number;
  maxPerHour: number;
  maxPerDay: number;
  cadenceMin: number;
  updatedAt: string;
}

export type ProactiveDecision =
  | 'sent'
  | 'skipped'
  | 'rate_limited'
  | 'quiet_hours'
  | 'disabled';

export type ProactiveCategory =
  | 'question'
  | 'status'
  | 'idea'
  | 'observation'
  | 'check-in';

export interface ProactiveAttemptRow {
  id: string;
  triggeredAt: string;
  decision: ProactiveDecision | string;
  reason: string | null;
  message: string | null;
  category: ProactiveCategory | string | null;
  costUsd: number | null;
}

export interface ProactiveRunNowResult {
  decision: ProactiveDecision | string;
  reason?: string | null;
  category?: ProactiveCategory | string | null;
}
