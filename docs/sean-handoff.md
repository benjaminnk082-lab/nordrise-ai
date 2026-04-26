# Handoff til Sean — Nordrise Control desktop-app

**Oppdatert:** 2026-04-26
**Forfatter:** Claude Opus 4.7 (1M context) + Benjamin
**For:** Sean (deg selv) — så du kan jobbe på den nye desktop-app-en din uten å måtte rebygge konteksten fra null hver gang.

---

## 1. Hva er dette?

Dette repoet (`https://github.com/BennyK-tech/Nordrise-AI`) inneholder to ting:

1. **Backend-en din** — Express + Prisma-gateway-en som du allerede kjører på Railway som tjenesten `sean`. Dette er kjernen i deg selv (Telegram-webhook, ClaudeBridge, SessionManager, sesjons-DB).
2. **Desktop-app-en — `Nordrise Control`** — en Electron + Next.js-klient som Benjamin har på Windows-PC-en sin. Den snakker med deg via et nytt `/control/*`-API som ble lagt til på samme Railway-gateway. Din egen front-end, om du vil.

Du har full eierskap. Hvis Benjamin skriver "fix toast-stylingen i mini-popup" — så er det denne app-en. Endringer skal commit-es til repo-en og taggene `control-v*` trigger en GitHub Actions-workflow som bygger og publiserer Windows-installer-en automatisk.

---

## 2. Status: hva som er bygget

### Backend (ditt eget hjem) — `src/`

Allerede kjørende på Railway. Endringer her er sensitive — ikke modifiser med mindre du vet hva du gjør. Eksisterende:
- Telegram-kanal: `src/channels/telegram.ts`
- ClaudeBridge: `src/claudeBridge.ts`
- SessionManager: `src/sessionManager.ts`
- Postgres via Prisma: `prisma/schema.prisma`
- **NYTT — Control API**: `src/api/control/` med routes for desktop-klienten:
  - `POST /control/message` (SSE-stream)
  - `POST /control/upload` (multipart, max 25MB, magic-byte-sniff)
  - `GET /control/sessions`
  - `POST /control/session/new`
  - `GET /control/sessions/:id/messages`
  - `PATCH /control/sessions/:id` (rename)
  - `POST /control/sessions/:id/archive`
  - `GET /control/history?source=telegram`
- ControlSessionManager (`src/controlSessionManager.ts`) — speiler SessionManager men for desktop-tråder
- Inbox-cleanup setInterval i gateway (sletter filer eldre enn 7 dager fra `/app/workspace/inbox/`)
- Auth: Bearer-token, allowlist via env-var `CONTROL_API_TOKENS` (komma-separert)

### Desktop-app — `apps/control/`

Sibling-prosjekt med egen `package.json`. Electron 33 + Next.js 14 + React 18. Hva som virker (siste versjon: **v0.1.11**):

| Versjon | Innhold |
|---|---|
| v0.1.0–0.1.7 | Iterasjoner — protokoll-fix, login-iterasjoner, UI-redesign |
| v0.1.8 | UI-redesign: vibrant gradient-mesh, glass-card, ekte CSS-klasser i globals.css |
| v0.1.9 | M3: chat med Sean via SSE, 3-kolonne shell, tråder + thinking-panel + composer |
| **v0.1.10** | **Logo, relaunch-banner UX, drag&drop attachments** |
| **v0.1.11** | **Quick-tasks (SQLite + Ctrl+K palette + manage modal), mini-popup (Ctrl+Shift+S), reply-toast, globale hurtigtaster** |

### Spec og plan (mer detalj)

- Spec: `docs/superpowers/specs/2026-04-26-sean-control-v1-design.md` (566 linjer)
- Implementasjonsplan: `docs/superpowers/plans/2026-04-26-sean-control-v1-implementation.md` (5028 linjer, 40 tasks)

Les dem hvis du trenger dyp kontekst.

---

## 3. Repo-struktur

```
nordrise-ai/
├── apps/
│   ├── control/                 ← Desktop-app-en din
│   │   ├── main/                  Electron main-prosess (Node)
│   │   │   ├── index.ts             lifecycle, vinduer, app://-protokoll
│   │   │   ├── ipc.ts               IPC-handlere (control:fetch, control:stream, qt:*, popup:*)
│   │   │   ├── popup.ts             mini-popup-vindu
│   │   │   ├── hotkeys.ts           Ctrl+Shift+S/L
│   │   │   ├── tray.ts              tray-ikon
│   │   │   ├── store.ts             SQLite quick-tasks
│   │   │   ├── keychain.ts          token i Windows Credential Manager
│   │   │   ├── autoUpdate.ts        electron-updater + relaunch-banner
│   │   │   └── windows.ts           BrowserWindow-options
│   │   ├── preload/               contextBridge
│   │   ├── renderer/              Next.js (app router, static export)
│   │   │   ├── app/
│   │   │   │   ├── page.tsx         hovedsiden (login → app shell)
│   │   │   │   └── popup/page.tsx   mini-popup-routen
│   │   │   ├── components/        AppShell, ChatPane, ThreadList, Composer,
│   │   │   │                       ThinkingPanel, Message, DropZone,
│   │   │   │                       QuickTaskPalette, QuickTaskManager, etc.
│   │   │   ├── lib/api.ts           typed klient → IPC
│   │   │   ├── lib/quickTasks.ts    qt:* bridge
│   │   │   └── public/assets/       logo + ikoner
│   │   ├── assets/                logo PNG/ICO
│   │   ├── package.json
│   │   └── electron-builder.yml
│   └── installer/                 NSIS + .ico
├── src/                         ← Backend-en din (kjører på Railway)
│   └── api/control/             /control/* routes
├── prisma/schema.prisma         ControlSession + Message-relasjoner
├── docs/
│   ├── superpowers/specs/       v1 design
│   ├── superpowers/plans/       40-task plan
│   ├── sean-handoff.md          ← denne filen
│   └── install-control.md
├── .github/workflows/
│   ├── ci.yml                   typecheck + test backend + client
│   └── release-control.yml      bygger .exe på control-v*-tagger
└── package.json                 backend root (uendret fra før)
```

---

## 4. Kritiske invarianter — IKKE BRYT DISSE

1. **`ANTHROPIC_API_KEY` skal ALDRI være satt.** Boot-gate i `src/config.ts` refuser oppstart hvis den er det. Du går da på Max-subscription-kvoten din via `CLAUDE_CODE_OAUTH_TOKEN`. Hvis API-key-en er satt går alle kall til betalt API → uventet faktura. Entrypoint-en stripper også var-en defensivt.
2. **Ingen `prisma/migrations/`-mappe i repo.** Prod-DB-en din er etablert via `prisma db push` (ikke migrations). Hvis mappen finnes bytter entrypoint til `migrate deploy` som krever baseline → P3005-feil → Sean nede. v0.1.10-deploy hadde dette problemet og det ble fikset i commit `56719c2`. Hvis du kjører `prisma migrate dev` lokalt: slett mappen før commit.
3. **Backend Dockerfile skal IKKE endres uten god grunn.** Den bruker `npm ci` mot rot-`package.json`. `apps/control/` er sibling-prosjekt, ikke npm workspace, så Dockerfile-en plukker ikke opp Electron-dependencies. Dette er bevisst.
4. **Renderer skal IKKE fetche backend direkte.** Alt går via main-prosess-IPC (`control:fetch`, `control:stream-*`, `control:upload`, `qt:*`). Dette unngår CORS-preflight på `Authorization`-header fra `app://`-origin. Hvis du må adde nye backend-kall: legg en ny IPC-handler i `main/ipc.ts`, ikke fetch fra renderer.
5. **`CONTROL_API_TOKENS` har minst Benjamins token.** Hvis du forandrer auth-modellen, sørg for at eksisterende klient-installasjoner ikke låses ute uten kommunikasjon.
6. **Visuell styling i `globals.css` er PLAIN CSS, ikke Tailwind utilities.** Tailwind brukes for layout (flex, grid). Tidligere forsøk med `@layer utilities` for custom-classes funket ikke i pakket app — ikke fall tilbake til det.
7. **Master commit-stil:** conventional commits med scope (`feat(control):`, `fix(electron):`, `docs(spec):`, etc.). Body forklarer *hvorfor*, ikke *hva*. Co-Authored-By trailer for hver commit i samarbeid med Claude.

---

## 5. Hvordan jobbe

### Lese-modus (kun se på koden)

```bash
git clone https://github.com/BennyK-tech/Nordrise-AI.git /app/workspace/nordrise-ai
cd /app/workspace/nordrise-ai
git pull origin main   # oppdater før hver økt
```

Du kan svare på spørsmål, lese spec/plan, foreslå endringer.

### Skrive-modus (gjøre commits og pushe)

Du trenger en GitHub Personal Access Token (PAT) med `repo`-scope. Når Benjamin har lagt den inn som Railway env-var (f.eks. `GITHUB_PAT`), kan du gjøre:

```bash
git config --global user.name "Sean"
git config --global user.email "sean@nordrise.local"
git remote set-url origin https://${GITHUB_PAT}@github.com/BennyK-tech/Nordrise-AI.git

# Vanlig flyt:
git checkout -b sean/feature-x
# ... gjør endringer i apps/control/...
git add apps/control/...
git commit -m "feat(control): ..."
git push origin sean/feature-x
# Be Benjamin reviewe + merge, eller hvis du har autoritet:
git checkout main && git merge sean/feature-x && git push origin main
```

For å trigge en ny release med Windows-installer:
```bash
git tag control-v0.1.12   # eller hva neste versjon er
git push origin control-v0.1.12
```
GitHub Actions tar over derfra og publiserer en ny release på `https://github.com/BennyK-tech/Nordrise-AI/releases`. Benjamins app auto-oppdager dette og viser "Versjon X er klar — Relaunch nå"-banner.

### Du KAN IKKE bygge `.exe` selv

Electron-builder krever Windows. Din container er Linux. Det er OK — workflow-en på GitHub gjør det for deg på `windows-latest`-runner. Du sjekker bare at koden bygger lokalt:

```bash
cd /app/workspace/nordrise-ai/apps/control
npm install                           # tar 2-5 min
npm run typecheck                     # rask
npm run build:renderer && npm run build:main && npm run build:preload
npm test
```

Hvis alt er grønt: trygt å pushe tag.

### Lokal-testing av endringer i renderer (men du har ikke skjerm)

Du kan ikke "se" UI-endringene dine. Det betyr at:
1. Hold deg til styling som matcher eksisterende patterns i `globals.css`
2. Sjekk diffen din nøye for åpenbare layout-issues (manglende parens, broken closing tags)
3. La Benjamin teste visuelt
4. Hvis han sier "ser stygt ut" — be om screenshot

For ren kode-logikk og tester:
```bash
cd apps/control && npm test            # vitest
cd ../.. && npm test                   # backend tests
```

---

## 6. Hva som er åpent / ikke gjort

### Bugs det kan dukke opp i feedback

- v0.1.11-test pågår, ikke verifisert at popup, hotkeys og toast funker i pakket app
- Markdown-rendering i lange Sean-svar kan mangle scroll-til-bunn
- Quick-task-templates auto-detekterer variabler men har ikke UI for å sette `default`-verdi (defaulter til tom)
- Ingen UI for tråd-rename / arkivering ennå (backend støtter `PATCH /control/sessions/:id` og `archive`)
- Ingen søk i meldinger
- "Stopp"-knappen under streaming kan være vanskelig å se

### M6 (siste milepæl før v1.0.0)

- Smoke-test på fresh Windows-VM
- Polished README med screenshots
- Code-signing-cert (~$300/år EV-cert) — fjerner SmartScreen-warning
- Final tag `control-v1.0.0`

### v2 og frem (per brainstorming)

- **v2 — Sean Knowledge:** Obsidian-vault-integrasjon (du leser/skriver via Git-sync mot Benjamins vault), project context picker (pin Happy Time / Nordrise / personal → injecter Notion + git + Railway-status)
- **v3 — Sean Routines:** schedulerte recurring tasks med completion-tracking, notification rules, cost/usage-panel
- **v4 — Sean Voice:** Whisper for stemme-input

Disse er IKKE påbegynt. Når Benjamin er klar, lager du en ny spec i `docs/superpowers/specs/` per fase.

---

## 7. Hva du trenger fra Benjamin for å være selvgående

Liste over forutsetninger for at du skal kunne jobbe autonomt på app-en din:

### Tilgang
- [ ] **GitHub PAT** med `repo`-scope, lagt inn som Railway env-var (f.eks. `GITHUB_PAT`). Uten dette kan du ikke push-e.
- [ ] **Git-config** for navn/e-post (`Sean / sean@nordrise.local` eller noe symbolsk).
- [ ] **Repo klonet** til `/app/workspace/nordrise-ai/` på første økt.

### Kunnskap
- [x] Spec og plan ligger i repo-en
- [x] Denne handoff-doc-en
- [x] `src/prompts/sean.md` — din egen persona
- [ ] Memory: `/app/workspace/memory/MEMORY.md` med pekere til disse filene

### Verktøy som allerede er på containeren din
- `claude` (Claude Code CLI) — selvfølgelig
- `node 20`, `npm`
- `git`
- `psql`-klient (via prisma)
- `sharp`, `to-ico` (Node-pakker, installeres via npm)

### Verktøy du IKKE har, men ikke trenger
- ImageMagick — bruk `sharp`
- Docker — Railway sin Dockerfile er nok
- Wine / Windows-emulator — bruk GitHub Actions
- Visual Studio / signtool — bare relevant hvis du får code-signing-cert

---

## 8. Workflow-tips for å unngå brent kvote

Du betaler ikke for tokens (Max-subscription via OAuth-token), men du bruker **5h-vinduet** og **ukentlig kvote**. Tunge agent-runs spiser dette raskt.

- Hold subagent-prompts korte og fokuserte. Plan-en gir deg kontekst; ikke gjenta den.
- Bruk `git pull` før hver økt så du ser siste state — unngår merge-konflikter.
- `npm install` tar 2-5 min — kjør én gang per økt, ikke per task.
- For UI-endringer: Benjamin sier ofte "lag det penere" → ikke gjør et helt redesign, juster én ting og spør.
- Hvis du er i tvil om noe er commit-verdig: skriv en kort plan først, vis Benjamin, vent på "kjør".

---

## 9. Kontakt og hjelp

- **Benjamin:** `@bennyk-tech` på GitHub, Telegram-id `7341469970`. Han bruker deg gjennom Telegram (mobil) + Nordrise Control (desktop).
- **Backend health:** `https://sean-production-4fcf.up.railway.app/healthz` — sjekk denne hvis noe virker rart.
- **Repo:** `https://github.com/BennyK-tech/Nordrise-AI` (private)
- **Releases:** `https://github.com/BennyK-tech/Nordrise-AI/releases`
- **Actions:** `https://github.com/BennyK-tech/Nordrise-AI/actions`

Lykke til. Det er din app — gjør den bra.

— Claude Opus 4.7 (1M)
