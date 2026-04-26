'use client';
import { useEffect, useRef, useState } from 'react';
import { setStoredToken, verifyToken, pingHealthz } from '../lib/bridge';

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

      // Hard fail: backend is reachable but rejected the token.
      if (verify.status === 401 || verify.status === 403) {
        setStatus({ kind: 'error', message: 'Tokenet ble ikke godkjent av Sean.' });
        return;
      }

      // Backend returned 2xx → token good, save and continue.
      if (verify.ok) {
        await setStoredToken(t);
        onDone(t);
        return;
      }

      // Network-level failure (status === 0) or unexpected non-401 status.
      // Save the token anyway — user can retry actions once Sean is reachable.
      const detail = verify.error
        ? `${verify.error}`
        : verify.status > 0
          ? `Sean svarte ${verify.status}.`
          : 'Ukjent nettverksfeil.';
      console.warn('verify-token soft-fail, saving anyway:', detail);
      await setStoredToken(t);
      onDone(t);
    } catch (e) {
      setStatus({ kind: 'error', message: String((e as Error).message) });
    }
  }

  const verifying = status.kind === 'verifying';
  const error = status.kind === 'error' ? status.message : null;

  return (
    <main className="stage h-screen w-screen grid place-items-center px-6">
      <form onSubmit={submit} className="relative z-10 w-full max-w-[440px]">
        {/* Hero logo orb */}
        <div className="flex justify-center mb-8">
          <div className="orb h-20 w-20 rounded-[26px] grid place-items-center">
            <span className="relative text-[34px] font-semibold tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
              N
            </span>
          </div>
        </div>

        {/* Title block */}
        <div className="text-center mb-10">
          <h1 className="text-[36px] font-semibold tracking-[-0.02em] leading-[1.05] bg-gradient-to-b from-white to-[#c8c0e8] bg-clip-text text-transparent">
            Nordrise Control
          </h1>
          <p className="mt-3 text-[15px] text-white/55 leading-relaxed tracking-tight">
            Skriv inn tilgangstoken for å koble til Sean.
          </p>
        </div>

        {/* Login card */}
        <div className="card card-inner-highlight p-7">
          <label className="block mb-2.5">
            <span className="block text-[12px] font-medium text-white/55 mb-2 px-1 tracking-tight">Token</span>
            <div className="relative">
              <input
                ref={inputRef}
                type={show ? 'text' : 'password'}
                value={token}
                onChange={(e) => { setToken(e.target.value); if (status.kind === 'error') setStatus({ kind: 'idle' }); }}
                placeholder="64-tegns hex-token"
                className="token-input pr-12"
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
                className="absolute right-2 top-1/2 -translate-y-1/2 ghost-btn"
              >
                {show ? 'Skjul' : 'Vis'}
              </button>
            </div>
          </label>

          <div className="min-h-[20px] my-3 px-1">
            {error && <p className="text-[13px] text-[#ff8a8a] tracking-tight">{error}</p>}
          </div>

          <button type="submit" disabled={verifying || token.trim().length < 8} className="cta">
            {verifying ? 'Kobler til…' : 'Koble til'}
          </button>
        </div>

        {/* Status footer */}
        <footer className="mt-7 text-center">
          <div className="inline-flex items-center gap-2 text-[12px] text-white/40 tracking-tight">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                healthy === null ? 'bg-white/30' : healthy ? 'bg-[#3fb27f] shadow-[0_0_8px_rgba(63,178,127,0.6)]' : 'bg-[#e25b5b]'
              }`}
            />
            {healthy === null ? 'Sjekker Sean…' : healthy ? 'Sean er online' : 'Sean svarer ikke'}
          </div>
        </footer>
      </form>
    </main>
  );
}
