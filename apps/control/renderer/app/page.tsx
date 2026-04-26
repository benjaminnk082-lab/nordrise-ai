'use client';
import { useEffect, useState } from 'react';
import { TokenLogin } from '../components/TokenLogin';
import { Stage } from '../components/Stage';
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
      <div className="card shell-card">
        <div className="brand" style={{ marginBottom: 24 }}>
          <div className="logo-orb" style={{ width: 64, height: 64, borderRadius: 18 }}>
            <span className="logo-orb-mark" style={{ fontSize: 26 }}>N</span>
          </div>
          <div className="brand-text">
            <h1 className="brand-title" style={{ fontSize: 28 }}>Du er koblet til Sean</h1>
            <p className="brand-subtitle">Chat-grensesnittet kommer i neste oppdatering.</p>
          </div>
        </div>

        {pendingUpdate && (
          <div className="update-pill">
            Versjon {pendingUpdate} klar — installeres når du lukker appen.
          </div>
        )}

        <div className="hairline" style={{ margin: '24px 0' }} />

        <div className="shell-meta">
          <span>v{version || '?'}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <button onClick={logout} className="link-button">Logg ut</button>
        </div>
      </div>
    </Stage>
  );
}
