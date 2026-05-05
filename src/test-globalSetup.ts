/**
 * Vitest globalSetup — boots embedded-postgres for the entire run, applies
 * the Prisma schema, and tears the cluster down on completion.
 *
 * Why we do this: the existing test suite was authored against a real
 * Postgres on `localhost:5432`. Without one, 39 tests in the message/sessions
 * route layer fail with "Can't reach database server". The `embedded-postgres`
 * devDep + `scripts/start-embedded-pg.mjs` were the intended workaround but
 * never got wired into vitest. This file does that wiring once, lifecycle-
 * managed.
 *
 * Port: 54329 (not 5432) so a developer running `npm test` doesn't collide
 * with their own dev Postgres or the gateway's `prisma migrate dev` workflow.
 *
 * The chosen DATABASE_URL is also written to `process.env` here so the
 * setupFile (src/test-setup.ts) can pick it up before any test imports
 * `@prisma/client`. Vitest sequences globalSetup → setupFiles → tests.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const DATA_DIR = process.env.EMBEDDED_PG_TEST_DATADIR
  ?? join(tmpdir(), 'nordrise-pg-test-data');
const PORT = Number(process.env.EMBEDDED_PG_TEST_PORT ?? 54329);
const DB_URL = `postgresql://postgres:postgres@localhost:${PORT}/postgres?schema=public`;
const URL_FILE = join(tmpdir(), 'nordrise-test-db-url');

let pg: EmbeddedPostgres | null = null;

export async function setup(): Promise<void> {
  // Persistent data dir survives between runs, dramatically speeding up
  // the second `npm test` (no re-init). Wipe it via EMBEDDED_PG_TEST_RESET=1.
  if (process.env.EMBEDDED_PG_TEST_RESET === '1' && existsSync(DATA_DIR)) {
    rmSync(DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(DATA_DIR, { recursive: true });

  pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: true,
  });
  await pg.initialise();
  await pg.start();

  // Workers spawned by vitest (forks pool) inherit env at process spawn
  // time, but this globalSetup runs in the parent process. The runtime env
  // change here propagates to child workers because vitest forks AFTER
  // globalSetup completes. setupFiles (src/test-setup.ts) reads env on
  // import, which happens inside the worker.
  process.env.DATABASE_URL = DB_URL;

  // Sidecar marker file in case some tooling needs to know the URL
  // independently of the parent process env.
  writeFileSync(URL_FILE, DB_URL, 'utf8');

  // Apply the schema with `prisma db push`. We deliberately use `db push`
  // instead of `migrate deploy` because the repo intentionally has no
  // migrations folder (DO NOT BREAK rule §6.2 in CLAUDE.md). The push is
  // idempotent and fast on the persistent data dir.
  const schemaPath = resolve('prisma/schema.prisma');
  const result = spawnSync(
    'npx',
    ['prisma', 'db', 'push', '--schema', schemaPath, '--skip-generate', '--accept-data-loss'],
    {
      env: { ...process.env, DATABASE_URL: DB_URL },
      stdio: 'pipe',
      shell: process.platform === 'win32',
    },
  );
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? '';
    const stdout = result.stdout?.toString() ?? '';
    throw new Error(
      `prisma db push failed (exit ${result.status})\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
  }
}

export async function teardown(): Promise<void> {
  if (pg) {
    try {
      await pg.stop();
    } catch {
      // best-effort — process exit will clean up sockets either way
    }
    pg = null;
  }
}
