'use client';
import ReactMarkdownPkg from 'react-markdown';
import rehypeHighlightPkg from 'rehype-highlight';

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
        ) : (
          <div className="bubble-md">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content || ''}</ReactMarkdown>
          </div>
        )}
        {streaming && content && <span className="streaming-cursor" />}
        {error && (
          <div className="bubble-error-msg">
            <span>Feil:</span> {error}
          </div>
        )}
      </div>
    </div>
  );
}
