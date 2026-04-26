// Standalone runner: start an embedded Postgres on port 5432 with
// user=postgres password=postgres. Used as a Docker substitute on Windows
// dev machines that don't have Docker installed.
import EmbeddedPostgres from 'embedded-postgres';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dataDir = process.env.EMBEDDED_PG_DATADIR ?? join(tmpdir(), 'nordrise-pg-data');
mkdirSync(dataDir, { recursive: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: 5432,
  persistent: true,
});

await pg.initialise();
await pg.start();

process.stdout.write('embedded-postgres listening on 5432 (user=postgres password=postgres)\n');
process.stdout.write(`data dir: ${dataDir}\n`);
process.stdout.write('press ctrl-c to stop\n');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
