import { useReducer, useCallback } from 'react';
import type { ControlMessageRow } from '../../src/server-types';

export type ToolStatus = 'running' | 'done';

export interface ToolCall {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status: ToolStatus;
  startedAt: number;
}

export type DraftMessage =
  | {
      kind: 'user';
      id: string;
      content: string;
      createdAt: string;
      pending?: boolean;
    }
  | {
      kind: 'assistant';
      id: string;
      content: string;
      createdAt: string;
      streaming: boolean;
      thinking: boolean;
      error?: string;
    };

export interface ThreadState {
  // Messages from the server (authoritative, persisted).
  serverMessages: ControlMessageRow[];
  // Optimistic drafts shown above server messages while a stream is in
  // flight. Cleared and replaced with server truth on stream completion.
  drafts: DraftMessage[];
  toolCalls: ToolCall[];
  streaming: boolean;
  errorMessage: string | null;
}

export const initialThreadState: ThreadState = {
  serverMessages: [],
  drafts: [],
  toolCalls: [],
  streaming: false,
  errorMessage: null,
};

type Action =
  | { type: 'load-server'; messages: ControlMessageRow[] }
  | { type: 'send'; userId: string; assistantId: string; text: string; createdAt: string }
  | { type: 'thinking' }
  | { type: 'partial'; assistantId: string; chunk: string }
  | { type: 'tool'; tool: { name: string; input?: string; output?: string; status: ToolStatus } }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'reset-drafts' }
  | { type: 'clear-error' };

function threadReducer(state: ThreadState, action: Action): ThreadState {
  switch (action.type) {
    case 'load-server':
      return { ...state, serverMessages: action.messages };

    case 'send':
      return {
        ...state,
        streaming: true,
        errorMessage: null,
        toolCalls: [],
        drafts: [
          {
            kind: 'user',
            id: action.userId,
            content: action.text,
            createdAt: action.createdAt,
          },
          {
            kind: 'assistant',
            id: action.assistantId,
            content: '',
            createdAt: action.createdAt,
            streaming: true,
            thinking: true,
          },
        ],
      };

    case 'thinking':
      return {
        ...state,
        drafts: state.drafts.map((d) =>
          d.kind === 'assistant' ? { ...d, thinking: true } : d,
        ),
      };

    case 'partial':
      return {
        ...state,
        drafts: state.drafts.map((d) =>
          d.kind === 'assistant' && d.id === action.assistantId
            ? { ...d, content: d.content + action.chunk, thinking: false }
            : d,
        ),
      };

    case 'tool': {
      // Match by name+running status — backend sends running then done with same name.
      const existing = [...state.toolCalls];
      const idx = existing.findIndex(
        (t) => t.name === action.tool.name && t.status === 'running',
      );
      if (action.tool.status === 'done' && idx >= 0) {
        existing[idx] = { ...existing[idx]!, ...action.tool, status: 'done' };
      } else {
        existing.push({
          id: `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          startedAt: Date.now(),
          ...action.tool,
        });
      }
      return { ...state, toolCalls: existing };
    }

    case 'done':
      return {
        ...state,
        streaming: false,
        drafts: state.drafts.map((d) =>
          d.kind === 'assistant' ? { ...d, streaming: false, thinking: false } : d,
        ),
      };

    case 'error':
      return {
        ...state,
        streaming: false,
        errorMessage: action.message,
        drafts: state.drafts.map((d) =>
          d.kind === 'assistant'
            ? { ...d, streaming: false, thinking: false, error: action.message }
            : d,
        ),
      };

    case 'reset-drafts':
      return { ...state, drafts: [] };

    case 'clear-error':
      return { ...state, errorMessage: null };

    default:
      return state;
  }
}

export function useThreadState() {
  const [state, dispatch] = useReducer(threadReducer, initialThreadState);

  const loadServer = useCallback(
    (messages: ControlMessageRow[]) => dispatch({ type: 'load-server', messages }),
    [],
  );
  const send = useCallback(
    (userId: string, assistantId: string, text: string, createdAt: string) =>
      dispatch({ type: 'send', userId, assistantId, text, createdAt }),
    [],
  );
  const onThinking = useCallback(() => dispatch({ type: 'thinking' }), []);
  const onPartial = useCallback(
    (assistantId: string, chunk: string) =>
      dispatch({ type: 'partial', assistantId, chunk }),
    [],
  );
  const onTool = useCallback(
    (tool: { name: string; input?: string; output?: string; status: ToolStatus }) =>
      dispatch({ type: 'tool', tool }),
    [],
  );
  const onDone = useCallback(() => dispatch({ type: 'done' }), []);
  const onError = useCallback(
    (message: string) => dispatch({ type: 'error', message }),
    [],
  );
  const resetDrafts = useCallback(() => dispatch({ type: 'reset-drafts' }), []);
  const clearError = useCallback(() => dispatch({ type: 'clear-error' }), []);

  return {
    state,
    loadServer,
    send,
    onThinking,
    onPartial,
    onTool,
    onDone,
    onError,
    resetDrafts,
    clearError,
  };
}
