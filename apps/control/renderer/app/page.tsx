'use client';
import { useEffect, useState } from 'react';
import { Setup } from '../components/Setup';
import { Login } from '../components/Login';
import { isSetupComplete } from '../lib/bridge';
import type { AccountName } from '../lib/bridge';

type Phase =
  | { kind: 'loading' }
  | { kind: 'setup' }
  | { kind: 'login' }
  | { kind: 'app'; name: AccountName; token: string };

export default function Page() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    isSetupComplete().then((ok) => setPhase(ok ? { kind: 'login' } : { kind: 'setup' }));
  }, []);

  if (phase.kind === 'loading') return <main className="grid h-screen place-items-center text-text-muted">Laster…</main>;
  if (phase.kind === 'setup') return <Setup onDone={() => setPhase({ kind: 'login' })}/>;
  if (phase.kind === 'login') return <Login onDone={(name, token) => setPhase({ kind: 'app', name, token })}/>;
  return (
    <main className="grid h-screen place-items-center text-text">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">✓ Logget inn som {phase.name}</h1>
        <p className="text-text-muted mt-2">Chat-vinduet kommer i M3.</p>
      </div>
    </main>
  );
}
