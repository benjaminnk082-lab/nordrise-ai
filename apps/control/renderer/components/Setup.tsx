'use client';
import { useState } from 'react';
import { setupAccounts } from '../lib/bridge';

export function Setup({ onDone }: { onDone: () => void }) {
  const [bP, setBP] = useState(''); const [bT, setBT] = useState('');
  const [mP, setMP] = useState(''); const [mT, setMT] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (bP.length < 4 || mP.length < 4) { setError('Passord må være minst 4 tegn.'); return; }
    if (bT.trim().length < 32 || mT.trim().length < 32) { setError('Hvert bearer-token må være minst 32 tegn.'); return; }
    setBusy(true);
    try {
      await setupAccounts([
        { name: 'Benjamin', password: bP, token: bT.trim() },
        { name: 'Martin', password: mP, token: mT.trim() },
      ]);
      onDone();
    } catch (e) { setError(String((e as Error).message)); }
    finally { setBusy(false); }
  }

  return (
    <main className="grid h-screen place-items-center bg-bg text-text overflow-y-auto py-8">
      <form onSubmit={submit} className="w-[480px] rounded-2xl border border-border bg-bg-elev p-8 shadow-2xl">
        <h1 className="text-2xl font-semibold mb-1">Velkommen til Nordrise Control</h1>
        <p className="text-text-muted text-sm mb-6">
          Sett opp innloggingen. To kontoer — Benjamin og Martin. Hver har eget passord og egen bearer-token (fra Sean / Railway).
        </p>

        <fieldset className="border border-border rounded-lg p-4 mb-4">
          <legend className="px-2 text-sm font-medium text-accent">Benjamin</legend>
          <label className="block mb-2 text-xs text-text-muted">Passord (min 4 tegn)</label>
          <input type="password" value={bP} onChange={(e) => setBP(e.target.value)} className="w-full rounded bg-bg-surface border border-border-strong px-3 py-2 text-sm mb-3"/>
          <label className="block mb-2 text-xs text-text-muted">Bearer-token</label>
          <input type="password" value={bT} onChange={(e) => setBT(e.target.value)} className="w-full rounded bg-bg-surface border border-border-strong px-3 py-2 text-sm font-mono"/>
        </fieldset>

        <fieldset className="border border-border rounded-lg p-4 mb-4">
          <legend className="px-2 text-sm font-medium text-accent">Martin</legend>
          <label className="block mb-2 text-xs text-text-muted">Passord (min 4 tegn)</label>
          <input type="password" value={mP} onChange={(e) => setMP(e.target.value)} className="w-full rounded bg-bg-surface border border-border-strong px-3 py-2 text-sm mb-3"/>
          <label className="block mb-2 text-xs text-text-muted">Bearer-token</label>
          <input type="password" value={mT} onChange={(e) => setMT(e.target.value)} className="w-full rounded bg-bg-surface border border-border-strong px-3 py-2 text-sm font-mono"/>
        </fieldset>

        {error && <p className="mb-3 text-danger text-sm">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-accent hover:bg-accent-hover py-2 text-sm font-medium disabled:opacity-50">
          {busy ? 'Lagrer…' : 'Fullfør oppsett'}
        </button>
      </form>
    </main>
  );
}
