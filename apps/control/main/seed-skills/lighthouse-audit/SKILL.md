---
name: lighthouse-audit
description: Run a Google Lighthouse audit against a public URL via the desktop client's local Chrome.
when_to_use: When the user asks to "check performance / SEO / accessibility" of a site, or pastes a URL with a vague "is this good?" question.
required_tools:
  - lighthouse_run
files: []
---

# Lighthouse audit

The desktop client has a `/lighthouse <url>` slash command (and a
button in the right panel) that calls into the local Chrome via the
`lighthouse:run` IPC channel. The audit runs *outside* Sean's process
— Sean just receives a structured summary back through the chat.

## Output shape (after the IPC returns)

```
**Lighthouse — <url>**

| Metric         | Score |
|----------------|-------|
| Performance    | NN    |
| Accessibility  | NN    |
| Best Practices | NN    |
| SEO            | NN    |

**Top issues to fix:**
1. **<title>** — <one-line description>. ~XXX ms saving.
2. **<title>** — <one-line description>.
3. **<title>** — <one-line description>.

Full JSON: `<vault>/Sean/audits/<date>-<domain>.json`
```

## Procedure

1. Confirm the URL is reachable and public (don't audit `localhost` —
   Sean has no Chrome instance behind the desktop client).
2. Trigger via `lighthouse:run` (the IPC layer handles Chrome lifecycle
   + JSON dump under `<vault>/Sean/audits/`).
3. Render the summary table inline. Pick the three lowest-scoring
   audits with `score < 0.9` and `details.overallSavingsMs > 0`.
4. Link to the JSON dump for the user to read in Obsidian.

## Don'ts

- Don't run more than one audit per turn unless the user asked for a
  comparison. Each run spawns headless Chrome.
- Don't re-run the same URL within 60 seconds — the Lighthouse number
  shifts ±3 between consecutive runs and confuses the user.
