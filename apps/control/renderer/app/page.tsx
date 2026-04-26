'use client';
import { useEffect, useState } from 'react';
import { TokenLogin } from '../components/TokenLogin';
import { Stage } from '../components/Stage';
import { AppShell } from '../components/AppShell';
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
      <Stage>
        <span className="status-pill">
          <span className="status-dot" />
          Laster…
        </span>
      </Stage>
    );
  }

  if (phase.kind === 'login') {
    return <TokenLogin onDone={(token) => setPhase({ kind: 'app', token })} />;
  }

  return (
    <Stage>
      <AppShell version={version} pendingUpdate={pendingUpdate} onLogout={logout} />
    </Stage>
  );
}
