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

  if (phase.kind === 'loading') return <main className="bg-aurora grid h-screen place-items-center text-text-muted text-[14px] tracking-tight">Laster…</main>;
  if (phase.kind === 'setup') return <Setup onDone={() => setPhase({ kind: 'login' })}/>;
  if (phase.kind === 'login') return <Login onDone={(name, token) => setPhase({ kind: 'app', name, token })}/>;
  return (
    <main className="bg-aurora h-screen w-screen grid place-items-center text-text">
      <div className="glass rounded-3xl px-12 py-10 text-center max-w-[440px]">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#7c5cff] to-[#9d6dff] text-[20px] font-semibold tracking-tight shadow-[0_8px_24px_rgba(124,92,255,0.4)]">
          {phase.name[0]}
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight leading-tight">Hei, {phase.name}.</h1>
        <p className="mt-3 text-[14px] text-text-muted leading-relaxed">
          Du er koblet til Sean. Chat-grensesnittet kommer i neste oppdatering.
        </p>
        <div className="hairline mt-6 mb-5" />
        <p className="text-[11px] text-text-subtle tracking-wide uppercase">Klar for M3</p>
      </div>
    </main>
  );
}
