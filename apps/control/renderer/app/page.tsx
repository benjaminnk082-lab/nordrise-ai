'use client';
import { useEffect, useState } from 'react';
import { TokenLogin } from '../components/TokenLogin';
import { getStoredToken, clearStoredToken } from '../lib/bridge';

type Phase =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'app'; token: string };

export default function Page() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    getStoredToken().then((tok) => setPhase(tok ? { kind: 'app', token: tok } : { kind: 'login' }));
  }, []);

  async function logout() {
    await clearStoredToken();
    setPhase({ kind: 'login' });
  }

  if (phase.kind === 'loading') {
    return (
      <main className="stage h-screen w-screen grid place-items-center">
        <p className="relative z-10 text-[14px] text-white/40 tracking-tight">Laster…</p>
      </main>
    );
  }
  if (phase.kind === 'login') {
    return <TokenLogin onDone={(token) => setPhase({ kind: 'app', token })} />;
  }
  return (
    <main className="stage h-screen w-screen grid place-items-center px-6">
      <div className="relative z-10 card card-inner-highlight p-10 max-w-[440px] text-center">
        <div className="flex justify-center mb-6">
          <div className="orb h-16 w-16 rounded-[22px] grid place-items-center">
            <span className="relative text-[26px] font-semibold tracking-tight text-white">N</span>
          </div>
        </div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] leading-tight bg-gradient-to-b from-white to-[#c8c0e8] bg-clip-text text-transparent">
          Du er koblet til Sean
        </h1>
        <p className="mt-3 text-[14px] text-white/55 leading-relaxed">
          Chat-grensesnittet kommer i neste oppdatering.
        </p>
        <div className="hairline my-6" />
        <div className="flex items-center justify-center gap-2 text-[11px] text-white/35 tracking-wide uppercase">
          <span>Klar for M3</span>
          <span className="opacity-50">·</span>
          <button onClick={logout} className="ghost-btn !p-0 !text-[11px] !uppercase tracking-wide">Logg ut</button>
        </div>
      </div>
    </main>
  );
}
