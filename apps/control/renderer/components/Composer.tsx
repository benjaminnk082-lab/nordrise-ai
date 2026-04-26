'use client';
import { useEffect, useRef, type KeyboardEvent } from 'react';

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
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea up to ~6 rows
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = '0px';
    const next = Math.min(ta.scrollHeight, 6 * 24 + 24);
    ta.style.height = `${next}px`;
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

  const hasUploading = attachments.some((a) => a.status === 'uploading');
  const hasContent = value.trim().length > 0 || attachments.some((a) => a.status === 'ready');
  const canSubmit = !disabled && !hasUploading && hasContent;

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
        <textarea
          ref={ref}
          className="composer-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          spellCheck
        />
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
    </div>
  );
}
