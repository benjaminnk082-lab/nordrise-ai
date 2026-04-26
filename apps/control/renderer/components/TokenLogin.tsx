'use client';
import { useEffect, useRef, useState } from 'react';
import { setStoredToken, verifyToken, pingHealthz } from '../lib/bridge';
import { Stage } from './Stage';

type Status =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'error'; message: string };

export function TokenLogin({ onDone }: { onDone: (token: string) => void }) {
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    pingHealthz().then((r) => setHealthy(r.status === 200));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = token.trim();
    if (t.length < 32) {
      setStatus({ kind: 'error', message: 'Tokenet må være minst 32 tegn.' });
      return;
    }
    setStatus({ kind: 'verifying' });
    try {
      const verify = await verifyToken(t);

      if (verify.status === 401 || verify.status === 403) {
        setStatus({ kind: 'error', message: 'Tokenet ble ikke godkjent av Sean.' });
        return;
      }

      if (verify.ok) {
        await setStoredToken(t);
        onDone(t);
        return;
      }

      const detail = verify.error ?? (verify.status > 0 ? `Sean svarte ${verify.status}.` : 'Ukjent nettverksfeil.');
      console.warn('[verify-token] soft-fail, saving anyway:', detail);
      await setStoredToken(t);
      onDone(t);
    } catch (e) {
      setStatus({ kind: 'error', message: String((e as Error).message) });
    }
  }

  const verifying = status.kind === 'verifying';
  const error = status.kind === 'error' ? status.message : null;

  return (
    <Stage>
      <form onSubmit={submit} className="login-shell">
        <div className="brand">
          <div className="logo-orb">
            <span className="logo-orb-mark">N</span>
          </div>
          <div className="brand-text">
            <h1 className="brand-title">Nordrise Control</h1>
            <p className="brand-subtitle">Skriv inn tilgangstoken for å koble til Sean.</p>
          </div>
        </div>

        <div className="card">
          <div className="row">
            <div className="field">
              <label htmlFor="token-input" className="field-label">Token</label>
              <div className="field-input-wrap">
                <input
                  ref={inputRef}
                  id="token-input"
                  type={show ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    if (status.kind === 'error') setStatus({ kind: 'idle' });
                  }}
                  placeholder="64-tegns hex"
                  className="field-input"
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  disabled={verifying}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  tabIndex={-1}
                  className="toggle-show"
                >
                  {show ? 'Skjul' : 'Vis'}
                </button>
              </div>
              {error && <div className="field-error">{error}</div>}
            </div>

            <button type="submit" disabled={verifying || token.trim().length < 8} className="cta">
              {verifying ? 'Kobler til…' : 'Koble til'}
            </button>
          </div>
        </div>

        <div className="foot">
          <span className="status-pill">
            <span
              className={`status-dot ${
                healthy === null ? '' : healthy ? 'online' : 'offline'
              }`}
            />
            {healthy === null ? 'Sjekker Sean…' : healthy ? 'Sean er online' : 'Sean svarer ikke'}
          </span>
        </div>
      </form>
    </Stage>
  );
}
