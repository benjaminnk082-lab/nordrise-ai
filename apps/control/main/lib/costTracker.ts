/**
 * costTracker — pure parsing of `usage` blocks from claude-code's
 * stream-json `result` event.
 *
 * The full `usage` shape (as of claude-code 1.0.x) includes:
 *   { input_tokens, output_tokens,
 *     cache_creation_input_tokens, cache_read_input_tokens,
 *     server_tool_use: { web_search_requests }, service_tier }
 *
 * For the StatusBar we only need the totals; for analytics later we
 * may surface cache hit-rate. Cost is informational on Max-subscription
 * (the field is reported but not billed) — we still persist it so the
 * Costs panel can show "what would this have cost on the API".
 *
 * Pure-Node module. The IPC layer in `main/ipc.ts` calls this from the
 * stream-done handler and pushes the result to the gateway via
 * `POST /control/sessions/:id/usage`.
 */

export interface ParsedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  modelId?: string;
  /** Total turn duration if present in the result event. */
  durationMs?: number;
}

interface UsageInputUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface UsageInput {
  type?: string;
  total_cost_usd?: number;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  modelUsage?: Record<string, unknown>;
  usage?: UsageInputUsage;
  result?: string;
}

function num(x: unknown): number {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  return 0;
}

/**
 * Parse a `result`-type stream-json event into a `ParsedUsage`. Any
 * missing field defaults to 0. Always returns a valid shape — never
 * throws — so a misshapen event from a future claude-code version
 * degrades gracefully.
 */
export function parseUsageFromResult(event: UsageInput): ParsedUsage {
  const u = event.usage ?? {};
  const cost = event.total_cost_usd ?? event.cost_usd ?? 0;
  const out: ParsedUsage = {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheCreationTokens: num(u.cache_creation_input_tokens),
    costUsd: num(cost),
    durationMs: event.duration_ms ?? event.duration_api_ms,
  };
  // First key under modelUsage is the model id (e.g. claude-opus-4-7-1m).
  if (event.modelUsage && typeof event.modelUsage === 'object') {
    const k = Object.keys(event.modelUsage)[0];
    if (k) out.modelId = k;
  }
  return out;
}

export function modelLabelFor(modelId: string): string {
  if (modelId.startsWith('claude-opus-4-7')) return 'Opus 4.7';
  if (modelId.startsWith('claude-sonnet-4-6')) return 'Sonnet 4.6';
  if (modelId.startsWith('claude-haiku-4-5')) return 'Haiku 4.5';
  return modelId;
}

/**
 * Sum of input + output tokens. Cache reads are excluded from the
 * "current session tokens" StatusBar number on purpose — they're
 * effectively free under Max, and surfacing them confuses users.
 */
export function totalTokens(u: ParsedUsage): number {
  return u.inputTokens + u.outputTokens;
}
