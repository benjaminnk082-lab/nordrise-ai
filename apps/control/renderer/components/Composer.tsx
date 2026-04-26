'use client';
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import ReactMarkdownPkg from 'react-markdown';
import rehypeHighlightPkg from 'rehype-highlight';

// react-markdown 9 ships ESM. Mirror Message.tsx's double-default guard so
// the preview renders identically to Sean's bubble.
type MarkdownComponent = typeof import('react-markdown').default;
const ReactMarkdown =
  ((ReactMarkdownPkg as unknown as { default?: MarkdownComponent }).default ??
    ReactMarkdownPkg) as MarkdownComponent;
type RehypeHighlightPlugin = typeof import('rehype-highlight').default;
const rehypeHighlight =
  ((rehypeHighlightPkg as unknown as { default?: RehypeHighlightPlugin }).default ??
    rehypeHighlightPkg) as RehypeHighlightPlugin;

/**
 * Threshold above which the "Forhåndsvis" link appears under the composer.
 * Below this, the preview toggle is hidden — short messages don't benefit
 * from a preview pane and the visual noise isn't worth it.
 */
const PREVIEW_TOGGLE_THRESHOLD = 200;

export interface ComposerAttachment {
  localId: string;
  filename: string;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
  fileId?: string;
  workspacePath?: string;
}

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onAbort: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  attachments?: ComposerAttachment[];
  onRemoveAttachment?: (localId: string) => void;
  /**
   * Called when files are picked via the paperclip button or pasted as image
   * data from the clipboard. Mirrors the DropZone callback so the same upload
   * pipeline in ChatPane handles all three input paths.
   */
  onFiles?: (files: File[]) => void;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  onAbort,
  streaming,
  disabled = false,
  placeholder = 'Spør Sean om hva som helst…',
  attachments = [],
  onRemoveAttachment,
  onFiles,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewMode, setPreviewMode] = useState(false);

  // Auto-resize textarea up to ~6 rows
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = '0px';
    const next = Math.min(ta.scrollHeight, 6 * 24 + 24);
    ta.style.height = `${next}px`;
  }, [value, previewMode]);

  // Send-time should drop preview so the composer is back to edit mode for
  // the next draft. Same when streaming starts (to keep the abort button
  // logic from rendering through a preview pane that has no input).
  useEffect(() => {
    if (value.length === 0) setPreviewMode(false);
  }, [value]);

  useEffect(() => {
    function onEsc(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape' && streaming) {
        e.preventDefault();
        onAbort();
      }
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [streaming, onAbort]);

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (!streaming && canSubmit) onSubmit();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!onFiles) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          // Clipboard images come in as `image.png` with no useful name —
          // give them a timestamped one so the chip and inbox path are sane.
          const ext = item.type.split('/')[1] ?? 'png';
          const named = new File(
            [file],
            `paste-${Date.now()}.${ext}`,
            { type: file.type },
          );
          imageFiles.push(named);
        }
      }
    }
    // Only intercept when there's an image item — preserve normal text paste.
    if (imageFiles.length > 0) {
      e.preventDefault();
      onFiles(imageFiles);
    }
  }

  function handlePickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length && onFiles) onFiles(files);
    // Reset so picking the same file twice in a row still fires onChange.
    e.target.value = '';
  }

  const hasUploading = attachments.some((a) => a.status === 'uploading');
  const hasContent = value.trim().length > 0 || attachments.some((a) => a.status === 'ready');
  const canSubmit = !disabled && !hasUploading && hasContent;
  const showPreviewToggle = !streaming && value.length > PREVIEW_TOGGLE_THRESHOLD;

  return (
    <div className="composer-wrap">
      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((a) => (
            <span
              key={a.localId}
              className={
                'attachment-chip' +
                (a.status === 'uploading' ? ' attachment-chip-uploading' : '') +
                (a.status === 'error' ? ' attachment-chip-error' : '')
              }
              title={a.status === 'error' ? a.error : a.filename}
            >
              <span aria-hidden="true">📎</span>
              <span className="attachment-chip-name">
                {a.filename}
                {a.status === 'uploading' && '…'}
              </span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  className="attachment-chip-remove"
                  onClick={() => onRemoveAttachment(a.localId)}
                  aria-label={`Fjern ${a.filename}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="composer">
        {onFiles && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handlePickerChange}
            />
            <button
              type="button"
              className="composer-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              title="Legg ved fil"
              aria-label="Legg ved fil"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 1 1-7.78-7.78l9.19-9.19a3.67 3.67 0 1 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 1 1-2.59-2.59l8.49-8.49"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        )}
        {previewMode && showPreviewToggle ? (
          // Markdown preview pane. Uses the same react-markdown +
          // rehype-highlight stack as Sean's bubble for visual parity. We
          // keep the textarea unmounted-but-preserved by storing draft in
          // the parent so flipping back is instant and cursor-clean.
          <div
            className="composer-preview bubble-md"
            role="region"
            aria-label="Forhåndsvisning av melding"
          >
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{value}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            ref={ref}
            className="composer-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKey}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            spellCheck
          />
        )}
        {streaming ? (
          <button
            type="button"
            className="send-btn send-btn-stop"
            onClick={onAbort}
            title="Avbryt (Esc)"
            aria-label="Avbryt strøm"
          >
            <span className="stop-square" />
          </button>
        ) : (
          <button
            type="button"
            className="send-btn"
            onClick={onSubmit}
            disabled={!canSubmit}
            title={hasUploading ? 'Venter på opplasting…' : 'Send (Enter)'}
            aria-label="Send melding"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 19V5M12 5l-6 6M12 5l6 6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      {showPreviewToggle && (
        <div className="composer-toggle-row">
          <button
            type="button"
            className="composer-link-btn"
            onClick={() => setPreviewMode((p) => !p)}
            aria-pressed={previewMode}
          >
            {previewMode ? '← Rediger' : 'Forhåndsvis →'}
          </button>
        </div>
      )}
    </div>
  );
}
