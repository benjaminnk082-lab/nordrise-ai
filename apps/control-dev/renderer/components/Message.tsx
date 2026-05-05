'use client';
import ReactMarkdownPkg from 'react-markdown';
import rehypeHighlightPkg from 'rehype-highlight';
import { useState, type ComponentPropsWithoutRef } from 'react';
import type { ReactionValue } from '../../src/server-types';

// react-markdown 9 ships ESM. Under Next's bundler we still need to
// guard for double-default packaging; pick the function out of either form.
type MarkdownComponent = typeof import('react-markdown').default;
const ReactMarkdown =
  ((ReactMarkdownPkg as unknown as { default?: MarkdownComponent }).default ??
    ReactMarkdownPkg) as MarkdownComponent;

type RehypeHighlightPlugin = typeof import('rehype-highlight').default;
const rehypeHighlight =
  ((rehypeHighlightPkg as unknown as { default?: RehypeHighlightPlugin }).default ??
    rehypeHighlightPkg) as RehypeHighlightPlugin;

export interface MessageProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  source?: 'desktop' | 'telegram';
  streaming?: boolean;
  thinking?: boolean;
  error?: string | null;
  /**
   * Persisted reaction on this assistant message, if any. Ignored for
   * non-assistant messages. Renderer-only; the parent handles persistence.
   */
  reaction?: ReactionValue | null;
  /**
   * Stable id for this message — required to fire onReact. Skipped for
   * optimistic drafts that don't yet have a server id (parent passes
   * undefined which disables the reaction buttons gracefully).
   */
  messageId?: string;
  /**
   * Toggle a reaction. Same value as currently set → clears it; otherwise
   * upserts. Parent owns the optimistic update + fetch.
   */
  onReact?: (messageId: string, next: ReactionValue | null) => void;
  /**
   * True iff this message is pinned. Star icon flips state via onTogglePin.
   * Skipped for drafts (no server id).
   */
  pinned?: boolean;
  onTogglePin?: (messageId: string) => void;
  /**
   * True for the LAST assistant message in the thread. When set, the
   * regenerate button renders next to the reactions so the user can retry
   * with the same prompt.
   */
  canRegenerate?: boolean;
  onRegenerate?: () => void;
}

/**
 * Custom <pre> renderer for ReactMarkdown that extracts the language hint
 * from the inner <code class="language-xxx"> and surfaces it as a small
 * Apple-style pill in the upper right corner via the `data-lang` attribute
 * (CSS draws the pill).
 */
function PreWithLangPill(props: ComponentPropsWithoutRef<'pre'>) {
  const { children, ...rest } = props;
  let lang: string | undefined;
  // Walk the immediate child <code> to read its class.
  const childArr = Array.isArray(children) ? children : [children];
  for (const c of childArr) {
    if (
      c &&
      typeof c === 'object' &&
      'props' in (c as Record<string, unknown>)
    ) {
      const childProps = (c as { props?: { className?: string } }).props;
      const cls = childProps?.className ?? '';
      const m = cls.match(/language-([\w-]+)/);
      if (m) {
        lang = m[1];
        break;
      }
    }
  }
  // Strip very-noisy "hljs" or unknown tokens; keep the human-readable lang.
  const dataLang = lang && lang !== 'hljs' ? lang : undefined;
  return (
    <pre {...rest} {...(dataLang ? { 'data-lang': dataLang } : {})}>
      {children}
    </pre>
  );
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Extract a plan from the start of an assistant reply.
 *
 * Recognises three shapes:
 *   1. "**Plan:**\n1. X\n2. Y\n3. Z" — explicit header
 *   2. "Jeg skal:\n1. X\n2. Y" — verb-of-intent header
 *   3. The very first 2-7 lines are a numbered list (no header)
 *
 * Returns `null` when no plan is detected so the renderer skips the
 * card. Anything the card consumes is stripped from the markdown body
 * to avoid duplication.
 */
interface ExtractedPlan {
  header: string;
  items: string[];
  rest: string;
}

function canonicalHeader(s: string): string {
  const lower = s.toLowerCase().trim();
  if (lower.startsWith('plan')) return 'Plan';
  if (lower.startsWith("i'll") || lower.startsWith('i will')) return 'Plan';
  return 'Jeg skal';
}

function extractPlan(raw: string): ExtractedPlan | null {
  if (!raw) return null;
  const text = raw.trimStart();
  const headerMatch = text.match(
    /^(?:\*\*|#+ ?)?(plan|jeg skal(?: gjøre)?|i['']?ll|i will)(?:\*\*)?:?\s*\n+/i,
  );
  let header: string | null = null;
  let body = text;
  if (headerMatch) {
    header = canonicalHeader(headerMatch[1] ?? '');
    body = text.slice(headerMatch[0].length);
  }
  const items: string[] = [];
  const lines = body.split(/\r?\n/);
  let consumed = 0;
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)[.)]\s+(.+?)\s*$/);
    if (!m) {
      if (items.length > 0) break;
      if (line.trim() === '' && consumed < 2) {
        consumed += 1;
        continue;
      }
      return null;
    }
    items.push(m[2] ?? '');
    consumed += 1;
  }
  if (items.length < 2 || items.length > 8) return null;
  const rest = lines.slice(consumed).join('\n').trimStart();
  return { header: header ?? 'Plan', items, rest };
}

export function Message({
  role,
  content,
  createdAt,
  source,
  streaming = false,
  thinking = false,
  error = null,
  reaction = null,
  messageId,
  onReact,
  pinned = false,
  onTogglePin,
  canRegenerate = false,
  onRegenerate,
}: MessageProps) {
  const time = formatTime(createdAt);
  const senderLabel =
    role === 'user'
      ? source === 'telegram'
        ? 'Du · Telegram'
        : 'Du'
      : role === 'system'
        ? 'System'
        : 'Sean';

  const canPin = !!messageId && !!onTogglePin && !streaming && !thinking && !error;

  if (role === 'user') {
    return (
      <div className="bubble-row bubble-row-user">
        <div className="bubble-meta bubble-meta-right">
          <span>{senderLabel}</span>
          {time && <span className="bubble-meta-time">{time}</span>}
          {canPin && (
            <button
              type="button"
              className={`pin-btn ${pinned ? 'pin-btn-active' : ''}`}
              onClick={() => onTogglePin!(messageId!)}
              aria-label={pinned ? 'Avfest melding' : 'Fest melding'}
              aria-pressed={pinned}
              title={pinned ? 'Avfest' : 'Fest melding'}
            >
              <span aria-hidden="true">{pinned ? '★' : '☆'}</span>
            </button>
          )}
        </div>
        <div className="bubble-user">{content}</div>
      </div>
    );
  }

  // Reactions are only meaningful on completed assistant replies. We hide
  // them while streaming/thinking and on error rows so the bubble stays
  // calm during generation.
  const canReact =
    role === 'assistant' &&
    !!messageId &&
    !!onReact &&
    !streaming &&
    !thinking &&
    !error;

  function handleReact(next: ReactionValue) {
    if (!canReact || !messageId || !onReact) return;
    // Click the active one → clear; otherwise upsert.
    onReact(messageId, reaction === next ? null : next);
  }

  // Copy-as-markdown — copies the raw assistant content (markdown) to
  // the clipboard and flashes a brief confirmation. Available on any
  // completed assistant message.
  const [copied, setCopied] = useState(false);
  const canCopy = role === 'assistant' && !streaming && !thinking && !error && !!content;
  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in some Electron sandbox configs; fall
      // through silently — user can still select text manually.
    }
  }

  // Plan extraction — only meaningful on assistant replies that aren't
  // streaming or errored (extracting from a half-arrived stream would
  // re-shuffle the UI on every chunk). Falls through to null = no card.
  const plan =
    role === 'assistant' && !streaming && !thinking && !error
      ? extractPlan(content)
      : null;

  return (
    <div className="bubble-row bubble-row-assistant">
      <div className="bubble-meta">
        <span>{senderLabel}</span>
        {time && <span className="bubble-meta-time">{time}</span>}
      </div>
      <div className={`bubble-assistant ${error ? 'bubble-error' : ''}`}>
        {thinking && !content && !error ? (
          <span className="thinking-dots" aria-label="Sean tenker…">
            <span />
            <span />
            <span />
          </span>
        ) : streaming && !content ? (
          // Apple-style typing dots while streaming hasn't yielded a chunk yet
          <span className="typing-dots" aria-label="Sean svarer…">
            <span />
            <span />
            <span />
          </span>
        ) : (
          <>
            {plan && (
              <div className="plan-card" role="group" aria-label={plan.header}>
                <div className="plan-card-head">
                  <span className="plan-card-glyph" aria-hidden="true">▶</span>
                  <span className="plan-card-title">{plan.header}</span>
                  <span className="plan-card-count">
                    {plan.items.length} steg
                  </span>
                </div>
                <ol className="plan-card-list">
                  {plan.items.map((item: string, i: number) => (
                    <li key={i} className="plan-card-item">
                      <span className="plan-card-num" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span className="plan-card-text">{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="bubble-md">
              <ReactMarkdown
                rehypePlugins={[rehypeHighlight]}
                components={{ pre: PreWithLangPill }}
              >
                {plan ? plan.rest : content || ''}
              </ReactMarkdown>
            </div>
          </>
        )}
        {streaming && content && <span className="streaming-cursor" />}
        {error && (
          <div className="bubble-error-msg">
            <span>Feil:</span> {error}
          </div>
        )}
      </div>
      {(canReact || canPin || canRegenerate || canCopy) && (
        <div className="message-reactions">
          {canCopy && (
            <button
              type="button"
              className="reaction-btn"
              onClick={() => void handleCopy()}
              aria-label="Kopier som markdown"
              title={copied ? 'Kopiert' : 'Kopier som markdown'}
            >
              <span aria-hidden="true">{copied ? '✓' : '📋'}</span>
            </button>
          )}
          {canReact && (
            <>
              <button
                type="button"
                className={
                  'reaction-btn' +
                  (reaction === 'up' ? ' reaction-active reaction-up' : '')
                }
                onClick={() => handleReact('up')}
                aria-label="Bra svar"
                aria-pressed={reaction === 'up'}
                title="Bra svar"
              >
                <span aria-hidden="true">👍</span>
              </button>
              <button
                type="button"
                className={
                  'reaction-btn' +
                  (reaction === 'down' ? ' reaction-active reaction-down' : '')
                }
                onClick={() => handleReact('down')}
                aria-label="Dårlig svar"
                aria-pressed={reaction === 'down'}
                title="Endre tilnærming"
              >
                <span aria-hidden="true">👎</span>
              </button>
            </>
          )}
          {canPin && (
            <button
              type="button"
              className={`pin-btn ${pinned ? 'pin-btn-active' : ''}`}
              onClick={() => onTogglePin!(messageId!)}
              aria-label={pinned ? 'Avfest melding' : 'Fest melding'}
              aria-pressed={pinned}
              title={pinned ? 'Avfest' : 'Fest melding'}
            >
              <span aria-hidden="true">{pinned ? '★' : '☆'}</span>
            </button>
          )}
          {canRegenerate && onRegenerate && (
            <button
              type="button"
              className="reaction-btn"
              onClick={() => onRegenerate()}
              aria-label="Regenerer svar"
              title="Regenerer svar"
            >
              <span aria-hidden="true">🔄</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
