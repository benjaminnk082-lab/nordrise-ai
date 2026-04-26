'use client';
import { useEffect, useState } from 'react';
import { TokenLogin } from '../components/TokenLogin';
import { getStoredToken, clearStoredToken, getAppVersion, getPendingUpdate } from '../lib/bridge';

type Phase =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'app'; token: string };

export default function Page() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [version, setVersion] = useState<string>('');
  const [pendingUpdate, setPendingUpdate] = useState<string | null>(null);

  useEffect(() => {
    getStoredToken().then((tok) => setPhase(tok ? { kind: 'app', token: tok } : { kind: 'login' }));
    getAppVersion().then(setVersion);
  }, []);

  // Poll for downloaded updates every 30s while on the app screen.
  useEffect(() => {
    if (phase.kind !== 'app') return;
    const tick = () => { void getPendingUpdate().then(setPendingUpdate); };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [phase.kind]);

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

        {pendingUpdate && (
          <div className="mt-5 rounded-xl border border-[#7c5cff]/30 bg-[#7c5cff]/10 px-4 py-2.5 text-[12px] text-[#c4b0ff]">
            Versjon {pendingUpdate} klar — installeres når du lukker appen.
          </div>
        )}

        <div className="hairline my-6" />
        <div className="flex items-center justify-center gap-2 text-[11px] text-white/35 tracking-wide">
          <span className="uppercase">v{version || '?'}</span>
          <span className="opacity-50">·</span>
          <button onClick={logout} className="ghost-btn !p-0 !text-[11px] tracking-wide">Logg ut</button>
        </div>
      </div>
    </main>
  );
}
