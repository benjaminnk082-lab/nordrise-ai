---
name: obsidian-note-management
description: Create, update, and link notes inside the user's Obsidian vault under Sean/.
when_to_use: When the user asks to "save", "note", "remember", or "log" something they want to keep across sessions. Also when long-running research warrants a persistent note.
required_tools:
  - vault_read_sean
  - vault_write_sean
files: []
---

# Obsidian note management

The desktop client owns atomic writes into `<vault>/Sean/`. Use the
`vault:read-sean` / `vault:write-sean` IPC channels (invoke through
the desktop tool surface, not direct filesystem reads from Sean's
shell). Atomic writes are mandatory — see CLAUDE.md §13.

## Folders that are yours

| Folder | Purpose |
|---|---|
| `Sean/HEARTBEAT.md` | checklist Sean reads every 30-min idle tick |
| `Sean/memories.md` | append-only long-term log (one entry per insight) |
| `Sean/sessions/` | one note per chat session (date+sessionId filename) |
| `Sean/projects/` | per-project context (e.g. `Tid for Service.md`) |
| `Sean/errors.md` | local error log (don't write here — the desktop does) |

## Conventions

- **Session notes** — `<YYYY-MM-DD>-<sid-prefix>.md`. Top of file is a
  one-line summary; rest is bullet points of decisions + open questions.
- **Project notes** — name matches the project's display name. First
  line is `# <Project>`; sections include `## Status`, `## Active
  threads`, `## Open questions`.
- **Memories** — append a `### YYYY-MM-DD <one-line headline>` block
  followed by 2-4 sentences. Never edit older memories — append a
  correction below instead.

## Procedure for "save this"

1. Decide where the note belongs: session vs project vs memory.
2. Read existing content (`vault:read-sean`) so you don't clobber
   prior edits. Atomic writes mean Obsidian won't see half-files, but
   if you fully replace a file you can still erase content the user
   added between your reads.
3. Compose the new content with the existing content above it.
4. Write back (`vault:write-sean`) with the merged body.
5. Tell the user where you saved it.

## Don'ts

- Never write outside `<vault>/Sean/`. The user owns the rest of the
  vault.
- Never delete a file. If the user asks you to "remove" something,
  comment it out with `<!-- removed YYYY-MM-DD: <reason> -->` so the
  history survives.
- Never overwrite a note without first reading it.
