'use client';
import { useCallback, useRef } from 'react';
import { sendMessageStream, type SseFrame } from '../lib/api';

export interface UseStreamCallbacks {
  onSession?: (claudeSessionId: string, controlSessionId: string) => void;
  onThinking?: () => void;
  onPartial?: (chunk: string) => void;
  onTool?: (tool: {
    name: string;
    input?: string;
    output?: string;
    status: 'running' | 'done';
  }) => void;
  onDone?: (data: {
    durationMs?: number;
    costUsdInformational?: number;
    isError?: boolean;
  }) => void;
  onError?: (message: string) => void;
  onComplete?: () => void;
}

export function useStream(callbacks: UseStreamCallbacks) {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const handleRef = useRef<{ abort: () => void } | null>(null);

  const start = useCallback(
    (opts: {
      controlSessionId: string | null;
      text: string;
      attachments?: Array<{ fileId: string; workspacePath: string; filename: string }>;
      model?: string;
    }) => {
      if (handleRef.current) handleRef.current.abort();
      const handle = sendMessageStream({
        controlSessionId: opts.controlSessionId,
        text: opts.text,
        attachments: opts.attachments,
        ...(opts.model ? { model: opts.model } : {}),
        onFrame: (f: SseFrame) => {
          const cb = cbRef.current;
          switch (f.event) {
            case 'thinking':
              cb.onThinking?.();
              break;
            case 'session': {
              const d = f.data as { claudeSessionId?: string; controlSessionId?: string };
              if (d.claudeSessionId && d.controlSessionId)
                cb.onSession?.(d.claudeSessionId, d.controlSessionId);
              break;
            }
            case 'partial': {
              const txt = (f.data as { text?: string }).text ?? '';
              if (txt) cb.onPartial?.(txt);
              break;
            }
            case 'tool': {
              const d = f.data as {
                name: string;
                input?: string;
                output?: string;
                status: 'running' | 'done';
              };
              cb.onTool?.(d);
              break;
            }
            case 'done':
              cb.onDone?.(f.data as never);
              break;
            case 'error':
              cb.onError?.(((f.data as { message?: string }).message) ?? 'unknown_error');
              break;
            case 'heartbeat':
              break;
            default:
              break;
          }
        },
        onDone: () => {
          handleRef.current = null;
          cbRef.current.onComplete?.();
        },
      });
      handleRef.current = handle;
    },
    [],
  );

  const abort = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.abort();
      handleRef.current = null;
    }
  }, []);

  return { start, abort, isActive: () => handleRef.current !== null };
}
