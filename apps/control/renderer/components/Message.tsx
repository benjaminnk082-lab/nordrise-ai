'use client';
import ReactMarkdownPkg from 'react-markdown';
import rehypeHighlightPkg from 'rehype-highlight';
import type { ComponentPropsWithoutRef } from 'react';
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

  if (role === 'user') {
    return (
      <div className="bubble-row bubble-row-user">
        <div className="bubble-meta bubble-meta-right">
          <span>{senderLabel}</span>
          {time && <span className="bubble-meta-time">{time}</span>}
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
          <div className="bubble-md">
            <ReactMarkdown
              rehypePlugins={[rehypeHighlight]}
              components={{ pre: PreWithLangPill }}
            >
              {content || ''}
            </ReactMarkdown>
          </div>
        )}
        {streaming && content && <span className="streaming-cursor" />}
        {error && (
          <div className="bubble-error-msg">
            <span>Feil:</span> {error}
          </div>
        )}
      </div>
      {canReact && (
        <div className="message-reactions">
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
        </div>
      )}
    </div>
  );
}
