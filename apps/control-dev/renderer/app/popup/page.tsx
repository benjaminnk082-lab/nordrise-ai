'use client';
import { useEffect, useRef, useState } from 'react';
import { sendMessageStream } from '../../lib/api';

export default function PopupPage() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        abortRef.current?.();
        void window.nordrise.invoke('popup:close');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    let assistantText = '';
    const stream = sendMessageStream({
      controlSessionId: null,
      text: t,
      onFrame: (f) => {
        if (f.event === 'partial' && typeof f.data?.text === 'string') {
          assistantText += f.data.text;
        }
      },
      onDone: () => {
        void window.nordrise.invoke('popup:reply', {
          user: t,
          assistant: assistantText,
        });
        void window.nordrise.invoke('popup:close');
      },
    });
    abortRef.current = stream.abort;
  }

  return (
    <main className="popup-shell">
      <form onSubmit={submit} className="popup-form">
        <header className="popup-header">
          <span className="popup-brand">⚡ Sean</span>
          <button
            type="button"
            className="popup-close"
            onClick={() => void window.nordrise.invoke('popup:close')}
            aria-label="Lukk"
          >
            ×
          </button>
        </header>
        <div className="popup-row">
          <input
            ref={ref}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Skriv en quick task…"
            disabled={busy}
            className="popup-input"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="popup-send"
          >
            {busy ? '…' : '↑'}
          </button>
        </div>
      </form>
    </main>
  );
}
