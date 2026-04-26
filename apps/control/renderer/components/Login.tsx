'use client';
import { useEffect, useRef, useState } from 'react';
import { login } from '../lib/bridge';
import type { AccountName } from '../lib/bridge';

const USERS: { name: AccountName; accent: string }[] = [
  { name: 'Benjamin', accent: 'from-[#7c5cff] to-[#9d6dff]' },
  { name: 'Martin', accent: 'from-[#5b9dff] to-[#7c5cff]' },
];

export function Login({ onDone }: { onDone: (name: AccountName, token: string) => void }) {
  const [name, setName] = useState<AccountName>('Benjamin');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [name]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(name, pwd);
      if (!r.ok) {
        setError('Feil passord eller mangler token.');
        setPwd('');
        return;
      }
      onDone(name, r.token);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="bg-aurora h-screen w-screen overflow-hidden">
      <div className="h-full grid place-items-center px-6">
        <form onSubmit={submit} className="w-full max-w-[400px]">
          <div className="flex justify-center gap-12 mb-10">
            {USERS.map((u) => {
              const active = u.name === name;
              return (
                <button
                  key={u.name}
                  type="button"
                  onClick={() => { setName(u.name); setPwd(''); setError(null); }}
                  className="group flex flex-col items-center gap-3 outline-none"
                >
                  <div
                    className={`relative h-20 w-20 rounded-full grid place-items-center bg-gradient-to-br ${u.accent} text-[28px] font-semibold tracking-tight transition-all duration-300 ${
                      active
                        ? 'shadow-[0_0_0_3px_rgba(124,92,255,0.4),_0_12px_40px_rgba(124,92,255,0.45)] scale-105'
                        : 'opacity-50 grayscale-[40%] group-hover:opacity-90 group-hover:scale-[1.02]'
                    }`}
                  >
                    {u.name[0]}
                  </div>
                  <span className={`text-[14px] tracking-tight transition-colors ${active ? 'text-text font-medium' : 'text-text-muted group-hover:text-text'}`}>
                    {u.name}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="glass rounded-2xl p-5">
            <input
              ref={inputRef}
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder={`Passord for ${name}`}
              className="input-apple text-center"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="min-h-[20px] mt-3 text-center">
              {error && <span className="text-[12px] text-[#ff8a8a]">{error}</span>}
            </div>
            <button type="submit" disabled={busy || pwd.length === 0} className="btn-apple w-full mt-1">
              {busy ? 'Logger inn…' : 'Logg inn'}
            </button>
          </div>

          <p className="mt-8 text-center text-[12px] text-text-subtle tracking-wide">
            Nordrise Control
          </p>
        </form>
      </div>
    </main>
  );
}
