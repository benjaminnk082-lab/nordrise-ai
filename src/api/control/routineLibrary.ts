/**
 * routineLibrary.ts — curated catalog of pre-built routine templates.
 *
 * The desktop client renders these in Settings → Rutiner → "Bibliotek"-tab.
 * One-click "Aktiver" creates a routine via POST /control/routines using the
 * template's prefilled fields. Templates are server-side only so we can curate
 * them centrally without shipping a desktop update.
 */

import { Router } from 'express';
import { makeRequireControlToken } from './auth.js';

export interface RoutineTemplate {
  id: string;
  name: string;
  description: string;
  emoji: string;
  prompt: string;
  schedule: string;
  channel: 'desktop' | 'telegram' | 'both';
  model?: string;
  category: 'daglig' | 'ukentlig' | 'codebase' | 'web-dev' | 'forretning';
}

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: 'daily-standup',
    emoji: '☀️',
    name: 'Morgenrapport',
    description:
      'Daglig oppsummering 08:30: gårsdagens commits, åpne PRs, dagens kalender, prioriteter.',
    category: 'daglig',
    prompt: `Skriv en kort morgenrapport (max 6 linjer) for Benjamin. Inkluder:
1. Datoen i dag
2. Hvis du har tilgang til vault/Daglig/<dato>.md, oppsummer kort
3. Sjekk vault/Sean/MEMORY.md for kontekst om aktive prosjekter
4. Foreslå én konkret prioritering for dagen

Rett, konsist, norsk.`,
    schedule: '30 8 * * *',
    channel: 'telegram',
    model: 'claude-haiku-4-5',
  },
  {
    id: 'weekly-summary',
    emoji: '📊',
    name: 'Ukerapport (fredag)',
    description:
      'Hver fredag 18:00: oppsummering av uken som notat i vault.',
    category: 'ukentlig',
    prompt: `Skriv en ukerapport for denne uken. Inkluder:
1. Hovedhendelser (commits, deploys, beslutninger)
2. Hva ble utført vs planlagt
3. Læringer
4. Fokus for neste uke

Skriv den til /app/workspace/sean-notes/journal/<dagens-dato>-ukerapport.md
Lengde: 300-600 ord. Norsk.`,
    schedule: '0 18 * * 5',
    channel: 'desktop',
  },
  {
    id: 'codebase-health',
    emoji: '🏥',
    name: 'Codebase-helse',
    description:
      'Daglig 09:00: sjekk for stale TODOs, feilende tester, store filer som vokser.',
    category: 'codebase',
    prompt: `Sjekk /app/workspace/codebase/ for:
1. TODO/FIXME-kommentarer over en uke gamle (grep + git blame)
2. Filer som har vokst forbi 500 linjer (find + wc)
3. Antall TS-feil hvis du kan kjøre tsc

Rapport til Telegram: kun om noe er verdt å nevne. Hvis ingenting, ikke send.`,
    schedule: '0 9 * * *',
    channel: 'telegram',
    model: 'claude-haiku-4-5',
  },
  {
    id: 'lighthouse-check',
    emoji: '🦊',
    name: 'Lighthouse-sjekk (krever Vercel-prosjekt)',
    description: 'Daglig: PageSpeed Insights mot prod-URL.',
    category: 'web-dev',
    prompt: `Hvis du har et prod-URL i vault/Grunderskap/ (eller spør Benjamin), kjør PageSpeed Insights via:

curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=<URL>&category=performance&category=accessibility"

Rapporter Performance + Accessibility scores. Alarmer hvis under 70. Lagre fullt resultat i sean-notes/lighthouse/<dato>.md.`,
    schedule: '0 8 * * *',
    channel: 'telegram',
    model: 'claude-haiku-4-5',
  },
  {
    id: 'vercel-deploys',
    emoji: '🚀',
    name: 'Vercel deploys (krever Vercel-token)',
    description: 'Hver time: sjekk siste deploys, alarmer hvis FAILED.',
    category: 'web-dev',
    prompt: `Hvis VERCEL_TOKEN er tilgjengelig:

curl -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v6/deployments?limit=5"

Rapporter hvis noen er state=ERROR eller CANCELED. Hvis alt READY: stille (ikke send Telegram).`,
    schedule: '0 * * * *',
    channel: 'telegram',
    model: 'claude-haiku-4-5',
  },
  {
    id: 'memory-update',
    emoji: '🧠',
    name: 'Oppdater MEMORY.md (ukentlig)',
    description:
      'Søndag 20:00: kondenser sean-notes/learnings inn i MEMORY.md.',
    category: 'ukentlig',
    prompt: `Les alle filer i /app/workspace/sean-notes/learnings/ og oppdater /app/workspace/sean-notes/MEMORY.md.

MEMORY.md skal være EN side på max 5000 tegn med:
- Aktive prosjekter (Nordrise, Happy Time, andre)
- Benjamins viktigste preferanser
- Nylige beslutninger (siste 4 uker)
- Åpne spørsmål

Append-modus, ikke overskriv eksisterende seksjoner.`,
    schedule: '0 20 * * 0',
    channel: 'desktop',
  },
  {
    id: 'evening-reflection',
    emoji: '🌙',
    name: 'Kveldsrefleksjon',
    description:
      'Hver kveld 21:30: kort refleksjon — hva ble gjort, hva er åpent.',
    category: 'daglig',
    prompt: `Skriv en kort kveldsrefleksjon for i dag. Maks 4 linjer:
- Hva ble fullført
- Hva er åpent for i morgen
- Hvordan står Benjamin

Skriv til /app/workspace/sean-notes/journal/<dato>.md (append).`,
    schedule: '30 21 * * *',
    channel: 'desktop',
    model: 'claude-haiku-4-5',
  },
  {
    id: 'sean-dreams',
    emoji: '🌙',
    name: 'Sean Dreams (nattlig oppsummering)',
    description:
      'Hver natt 03:00: Sean går gjennom alle samtaler og vault-endringer fra siste døgn, oppdaterer MEMORY.md, og genererer morgenforslag.',
    category: 'daglig',
    prompt: `Dette er Sean Dreams. Du har 5 min mens Benjamin sover. Gjør følgende i rekkefølge:

1. Les /app/workspace/vault/Sean/MEMORY.md hvis den finnes
2. Sjekk hvilke filer i vaulten som ble endret siste døgn (bruk find + mtime)
3. Les nye notater og oppdateringer
4. Skriv en kondensert dagsoppsummering til /app/workspace/sean-notes/journal/<dagens-dato>.md
5. Oppdater /app/workspace/sean-notes/MEMORY.md med eventuelle nye fakta du har lært
6. Skriv 1-3 morgenforslag til /app/workspace/sean-notes/morning/<imorgen-dato>.md (hva Benjamin kan vurdere å fokusere på)

Hold deg under 5000 tegn total output. Ikke send Telegram (kanal er desktop). Norsk.`,
    schedule: '0 3 * * *',
    channel: 'desktop',
    model: 'claude-sonnet-4-6',
  },
];

export function makeRoutineLibraryRouter(allowedTokens: readonly string[]): Router {
  const r = Router();
  const auth = makeRequireControlToken(allowedTokens);

  r.get('/routine-library', auth, (_req, res) => {
    res.json({ templates: ROUTINE_TEMPLATES });
  });

  return r;
}
