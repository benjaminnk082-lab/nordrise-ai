// Provides minimal env vars so config.ts can be imported in tests.
// Real values are not used — tests stub or never call subsystems that need them.
//
// DATABASE_URL is normally set by `src/test-globalSetup.ts` to point at the
// embedded-postgres instance. Falls back to the legacy localhost:5432
// default for cases where someone runs vitest with --no-globalSetup or
// imports test files outside the harness.
process.env.CLAUDE_CODE_OAUTH_TOKEN ??= 'sk-ant-oat01-' + 'x'.repeat(40);
process.env.TELEGRAM_BOT_TOKEN ??= 'x'.repeat(40);
process.env.TELEGRAM_WEBHOOK_SECRET ??= 'x'.repeat(32);
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:54329/postgres?schema=public';
process.env.NODE_ENV ??= 'test';
