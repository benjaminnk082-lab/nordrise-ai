'use client';
import { useEffect, useRef, useState } from 'react';
import type { ControlMessageRow } from '../../src/server-types';
import { listHistory } from '../lib/api';
import { Message } from './Message';

export function TelegramHistory() {
  const [messages, setMessages] = useState<ControlMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listHistory('telegram', 100)
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String((err as Error).message));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="chat-pane">
      <div className="pane-header">
        <span className="pane-title">Telegram-logg</span>
        <span className="pane-subtitle">Skrivebeskyttet visning av Sean på Telegram</span>
      </div>

      <div className="message-list" ref={scrollRef}>
        {loading && <div className="pane-empty">Henter logg…</div>}
        {error && <div className="pane-empty pane-error">Kunne ikke hente: {error}</div>}
        {!loading && !error && messages.length === 0 && (
          <div className="pane-empty">Ingen Telegram-meldinger enda.</div>
        )}
        {messages.map((m) => (
          <Message
            key={m.id}
            role={m.role}
            content={m.content}
            createdAt={m.createdAt}
            source={m.source}
          />
        ))}
      </div>

      <div className="composer composer-readonly">
        Telegram-loggen er skrivebeskyttet. Bytt til en tråd for å chatte med Sean.
      </div>
    </div>
  );
}
