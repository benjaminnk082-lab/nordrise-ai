/**
 * ollama.ts — minimal Ollama localhost client.
 *
 * Uses Node's global fetch (Ollama is plain HTTP on 127.0.0.1, no Chromium
 * net-stack quirks to worry about). Streams via /api/generate.
 *
 * IMPORTANT: this module talks only to localhost; the host is configurable in
 * settings but the app never sends Ollama traffic over the network.
 */

export interface DetectResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export async function detectOllama(host: string): Promise<DetectResult> {
  try {
    const r = await fetch(`${host}/api/version`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!r.ok) return { ok: false, error: `http_${r.status}` };
    const j = (await r.json()) as { version?: string };
    return { ok: true, version: j.version };
  } catch (err) {
    return { ok: false, error: String((err as Error).message) };
  }
}

export async function listOllamaModels(host: string): Promise<string[]> {
  try {
    const r = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { models?: Array<{ name: string }> };
    return (j.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
  } catch {
    return [];
  }
}

export interface StreamOptions {
  host: string;
  model: string;
  prompt: string;
  /**
   * Optional system prompt injected via Ollama's `system` parameter. Used to
   * carry Sean's persona across providers — when a thread is routed locally,
   * the desktop app fetches `/control/persona` and passes it here so Sean
   * stays Sean even on Llama/Qwen.
   */
  system?: string;
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
  signal?: AbortSignal;
}

export async function streamOllama(opts: StreamOptions): Promise<void> {
  let r: Response;
  try {
    r = await fetch(`${opts.host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        prompt: opts.prompt,
        stream: true,
        ...(opts.system && opts.system.trim() ? { system: opts.system } : {}),
      }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    opts.onError(String((err as Error).message));
    opts.onDone();
    return;
  }
  if (!r.ok || !r.body) {
    opts.onError(`http_${r.status}`);
    opts.onDone();
    return;
  }

  const reader = (r.body as unknown as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line) as { response?: string; done?: boolean; error?: string };
          if (j.error) {
            opts.onError(j.error);
            opts.onDone();
            return;
          }
          if (j.response) opts.onChunk(j.response);
          if (j.done) {
            opts.onDone();
            return;
          }
        } catch {
          // skip malformed line
        }
      }
    }
  } catch (err) {
    const msg = (err as Error).name === 'AbortError'
      ? 'aborted'
      : String((err as Error).message);
    opts.onError(msg);
  } finally {
    opts.onDone();
  }
}
