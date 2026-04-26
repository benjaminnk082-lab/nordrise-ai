'use client';
import { useState } from 'react';
import { setStoredToken, pingHealthz } from '../lib/bridge';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const trimmed = token.trim();
      if (trimmed.length < 32) {
        setError('Token må være minst 32 tegn.');
        return;
      }
      await setStoredToken(trimmed);
      const hz = await pingHealthz();
      if (hz.status !== 200) {
        setError(`Backend svarte ${hz.status}. Sjekk at Sean kjører.`);
        return;
      }
      onDone();
    } catch (e) {
      setError(String((e as Error).message));
    } finally { setBusy(false); }
  }

  return (
    <main className="grid h-screen place-items-center bg-bg text-text">
      <form onSubmit={submit} className="w-[420px] rounded-2xl border border-border bg-bg-elev p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold mb-1">Nordrise Control</h1>
        <p className="text-text-muted text-sm mb-6">Lim inn din Sean control-token (fra <code>npm run issue-control-token</code> + Railway env).</p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="sk-... eller hex"
          className="w-full rounded-lg bg-bg-surface border border-border-strong px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent"
          autoFocus
        />
        {error && <p className="mt-3 text-danger text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-accent hover:bg-accent-hover py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Verifiserer…' : 'Koble til Sean'}
        </button>
      </form>
    </main>
  );
}
