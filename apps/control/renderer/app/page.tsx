'use client';
import { useEffect, useState } from 'react';
import { Onboarding } from '../components/Onboarding';
import { getStoredToken } from '../lib/bridge';

export default function Page() {
  const [phase, setPhase] = useState<'loading' | 'onboarding' | 'app'>('loading');

  useEffect(() => {
    getStoredToken().then((tok) => setPhase(tok ? 'app' : 'onboarding'));
  }, []);

  if (phase === 'loading') return <main className="grid h-screen place-items-center text-text-muted">Laster…</main>;
  if (phase === 'onboarding') return <Onboarding onDone={() => setPhase('app')} />;
  return (
    <main className="grid h-screen place-items-center text-text">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">✓ Koblet til Sean</h1>
        <p className="text-text-muted mt-2">Chat-vinduet kommer i M3.</p>
      </div>
    </main>
  );
}
