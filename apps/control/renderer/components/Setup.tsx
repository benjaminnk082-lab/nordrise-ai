'use client';
import { useState } from 'react';
import { setupAccounts } from '../lib/bridge';

interface AccountForm {
  password: string;
  token: string;
}

const initialForm: AccountForm = { password: '', token: '' };

export function Setup({ onDone }: { onDone: () => void }) {
  const [benjamin, setBenjamin] = useState<AccountForm>(initialForm);
  const [martin, setMartin] = useState<AccountForm>(initialForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (benjamin.password.length < 4 || martin.password.length < 4) {
      setError('Passord må være minst 4 tegn for begge brukere.');
      return;
    }
    if (benjamin.token.trim().length < 32 || martin.token.trim().length < 32) {
      setError('Hver bearer-token må være minst 32 tegn.');
      return;
    }
    setBusy(true);
    try {
      await setupAccounts([
        { name: 'Benjamin', password: benjamin.password, token: benjamin.token.trim() },
        { name: 'Martin', password: martin.password, token: martin.token.trim() },
      ]);
      onDone();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="bg-aurora h-screen w-screen overflow-y-auto">
      <div className="min-h-full grid place-items-center px-6 py-14">
        <form onSubmit={submit} className="w-full max-w-[560px]">
          <header className="text-center mb-10">
            <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl glass">
              <span className="text-[22px] font-semibold tracking-tight bg-gradient-to-br from-white to-[#a290ff] bg-clip-text text-transparent">N</span>
            </div>
            <h1 className="text-[32px] font-semibold tracking-tight leading-[1.1]">
              Velkommen til Nordrise Control
            </h1>
            <p className="mt-3 text-[15px] text-text-muted leading-relaxed max-w-[420px] mx-auto">
              Sett opp begge kontoer for å komme i gang. Hver bruker får eget passord og egen bearer-token mot Sean.
            </p>
          </header>

          <div className="glass rounded-3xl p-2 space-y-2">
            <AccountCard
              name="Benjamin"
              accent="from-[#7c5cff] to-[#9d6dff]"
              value={benjamin}
              onChange={setBenjamin}
              autoFocus
            />
            <div className="hairline mx-4" />
            <AccountCard
              name="Martin"
              accent="from-[#5b9dff] to-[#7c5cff]"
              value={martin}
              onChange={setMartin}
            />
          </div>

          <div className="mt-6 min-h-[28px]">
            {error && (
              <div className="rounded-xl border border-[#e25b5b]/30 bg-[#e25b5b]/10 px-4 py-2.5 text-[13px] text-[#ff8a8a]">
                {error}
              </div>
            )}
          </div>

          <button type="submit" disabled={busy} className="btn-apple mt-2 w-full">
            {busy ? 'Lagrer…' : 'Fullfør oppsett'}
          </button>

          <p className="mt-6 text-center text-[12px] text-text-subtle">
            Passord lagres lokalt på denne PC-en. Tokens lagres i Windows Credential Manager.
          </p>
        </form>
      </div>
    </main>
  );
}

interface AccountCardProps {
  name: 'Benjamin' | 'Martin';
  accent: string;
  value: AccountForm;
  onChange: (v: AccountForm) => void;
  autoFocus?: boolean;
}

function AccountCard({ name, accent, value, onChange, autoFocus }: AccountCardProps) {
  return (
    <div className="rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className={`h-9 w-9 rounded-full grid place-items-center bg-gradient-to-br ${accent} text-[14px] font-semibold tracking-tight shadow-[0_4px_12px_rgba(124,92,255,0.35)]`}>
          {name[0]}
        </div>
        <div className="flex-1">
          <div className="text-[15px] font-medium tracking-tight">{name}</div>
          <div className="text-[12px] text-text-subtle">Konto</div>
        </div>
      </div>

      <div className="space-y-3">
        <Field
          label="Passord"
          hint="min 4 tegn"
          type="password"
          value={value.password}
          onChange={(v) => onChange({ ...value, password: v })}
          autoFocus={autoFocus}
          placeholder="••••"
        />
        <Field
          label="Bearer-token"
          hint="fra Sean / Railway"
          type="password"
          value={value.token}
          onChange={(v) => onChange({ ...value, token: v })}
          mono
          placeholder="64 hex-tegn"
        />
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  type?: 'text' | 'password';
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  mono?: boolean;
}

function Field({ label, hint, type = 'text', value, onChange, autoFocus, placeholder, mono }: FieldProps) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5 px-1">
        <span className="text-[12px] font-medium text-text-muted tracking-tight">{label}</span>
        {hint && <span className="text-[11px] text-text-subtle">{hint}</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={`input-apple ${mono ? 'font-mono text-[13px]' : ''}`}
        spellCheck={false}
        autoComplete="new-password"
      />
    </label>
  );
}
