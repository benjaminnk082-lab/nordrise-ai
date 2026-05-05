'use client';
import { useState, useCallback } from 'react';
import {
  phase3Vault,
  type VaultCandidate,
} from '../lib/bridge';

/**
 * VaultSetupCard — first-run flow for picking / creating an Obsidian
 * vault. Self-contained component that:
 *   1. auto-detects via phase3Vault.detectCandidates,
 *   2. lets the user "Browse" via the OS folder picker, OR
 *   3. lets the user "Create new" at the default path.
 *
 * Resolves with the chosen vault path. Caller is expected to persist
 * via settingsApi.set({ vault: { localPath } }).
 */
export interface VaultSetupCardProps {
  /** Called when the user picks/creates a vault. */
  onPicked: (vaultPath: string) => void;
  /** Optional cancel button. */
  onCancel?: () => void;
}

export function VaultSetupCard({ onPicked, onCancel }: VaultSetupCardProps) {
  const [stage, setStage] = useState<'idle' | 'detecting' | 'creating'>('idle');
  const [candidates, setCandidates] = useState<VaultCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(async () => {
    setStage('detecting');
    setError(null);
    try {
      const cands = await phase3Vault.detectCandidates();
      setCandidates(cands);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStage('idle');
    }
  }, []);

  const browse = useCallback(async () => {
    setError(null);
    try {
      const path = await phase3Vault.pickFolder();
      if (!path) return;
      await phase3Vault.ensureSeanStructure(path);
      onPicked(path);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [onPicked]);

  const createNew = useCallback(async () => {
    setStage('creating');
    setError(null);
    try {
      const target = await phase3Vault.defaultNewPath();
      const r = await phase3Vault.create(target);
      onPicked(r.path);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStage('idle');
    }
  }, [onPicked]);

  const useThis = useCallback(
    async (path: string) => {
      try {
        await phase3Vault.ensureSeanStructure(path);
        onPicked(path);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [onPicked],
  );

  return (
    <div
      role="dialog"
      aria-label="Vault setup"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
        maxWidth: 520,
        margin: '0 auto',
        color: 'var(--text)',
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        Sett opp Obsidian-vault
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--text-muted)',
          marginBottom: 'var(--space-4)',
        }}
      >
        Sean lagrer minner, sesjonsnotater og audits i en mappe under{' '}
        <code>Sean/</code> i Obsidian-vaulten din. Velg en eksisterende vault
        eller opprett en ny.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="tb-icon-btn"
          data-emphasis="primary"
          onClick={() => void detect()}
          disabled={stage === 'detecting'}
        >
          {stage === 'detecting' ? 'Søker…' : 'Auto-detect'}
        </button>
        <button type="button" className="tb-icon-btn" data-emphasis="primary" onClick={() => void browse()}>
          Bla…
        </button>
        <button
          type="button"
          className="tb-icon-btn"
          data-emphasis="primary"
          onClick={() => void createNew()}
          disabled={stage === 'creating'}
        >
          {stage === 'creating' ? 'Oppretter…' : 'Opprett ny'}
        </button>
        {onCancel && (
          <button type="button" className="link-button" onClick={onCancel}>
            Avbryt
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-2)',
            background: 'rgba(220, 80, 80, 0.10)',
            border: '1px solid rgba(220, 80, 80, 0.30)',
            borderRadius: 'var(--radius-sm)',
            color: '#ffa3a3',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: 0.06,
              textTransform: 'uppercase',
              color: 'var(--text-faint)',
              marginBottom: 6,
            }}
          >
            Funn ({candidates.length})
          </div>
          {candidates.map((c) => (
            <button
              key={c.path}
              type="button"
              onClick={() => void useThis(c.path)}
              style={{
                display: 'flex',
                width: '100%',
                gap: 8,
                alignItems: 'center',
                padding: 'var(--space-2) var(--space-3)',
                background: 'transparent',
                color: 'var(--text)',
                border: '1px solid var(--separator)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 6,
                cursor: 'pointer',
                fontSize: 13,
                textAlign: 'left',
              }}
            >
              <span style={{ flex: 1 }}>{c.path}</span>
              <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                {c.hasSeanFolder ? 'har Sean/' : 'ny vault'}
              </span>
            </button>
          ))}
        </div>
      )}

      {candidates && candidates.length === 0 && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            fontSize: 12,
            color: 'var(--text-muted)',
          }}
        >
          Ingen Obsidian-vault funnet i <code>Documents/</code>,{' '}
          <code>Obsidian/</code> eller <code>OneDrive/</code>. Bruk{' '}
          <strong>Bla</strong> for å peke på en, eller{' '}
          <strong>Opprett ny</strong>.
        </div>
      )}
    </div>
  );
}
