'use client';
import { useState } from 'react';
import { login } from '../lib/bridge';
import type { AccountName } from '../lib/bridge';

export function Login({ onDone }: { onDone: (name: AccountName, token: string) => void }) {
  const [name, setName] = useState<AccountName>('Benjamin');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await login(name, pwd);
      if (!r.ok) { setError('Feil passord eller mangler token.'); return; }
      onDone(name, r.token);
    } catch (e) { setError(String((e as Error).message)); }
    finally { setBusy(false); }
  }

  return (
    <main className="grid h-screen place-items-center bg-bg text-text">
      <form onSubmit={submit} className="w-[400px] rounded-2xl border border-border bg-bg-elev p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold mb-6">Logg inn</h1>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(['Benjamin', 'Martin'] as AccountName[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setName(n)}
              className={`rounded-lg py-3 text-sm font-medium border ${
                name === n
                  ? 'bg-accent text-text border-accent'
                  : 'bg-bg-surface text-text-muted border-border-strong hover:text-text'
              }`}
            >{n}</button>
          ))}
        </div>
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          placeholder="Passord"
          autoFocus
          className="w-full rounded-lg bg-bg-surface border border-border-strong px-3 py-2 text-sm mb-3"
        />
        {error && <p className="mb-3 text-danger text-sm">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-accent hover:bg-accent-hover py-2 text-sm font-medium disabled:opacity-50">
          {busy ? 'Logger inn…' : 'Logg inn'}
        </button>
      </form>
    </main>
  );
}
