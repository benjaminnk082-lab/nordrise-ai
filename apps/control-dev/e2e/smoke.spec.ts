/**
 * End-to-end smoke test for `apps/control-dev`.
 *
 * Boots Electron with the sandbox copy, renders the main window, sends a
 * single message through the bridge, and asserts that an assistant reply
 * lands. Uses Playwright's Electron support
 * (`@playwright/test` >= 1.49 ships `_electron`).
 *
 * STATUS: scaffolded but skipped by default. To run:
 *
 *   1. `npm run sandbox:install` from repo root (~3-5 min, ~500 MB)
 *   2. Provide a `NORDRISE_BACKEND_URL` pointing at a local mock or live
 *      gateway with valid `CONTROL_API_TOKENS`.
 *   3. Set `RUN_ELECTRON_E2E=1` in the env to opt in.
 *   4. From `apps/control-dev/`: `npx playwright test e2e/smoke.spec.ts`
 *
 * Why scaffolded-but-skipped: the spec asks for a single end-to-end test
 * that boots control-dev. Implementing the full harness (mock backend +
 * Playwright Electron + headless display) inside the foundation session
 * would balloon scope, and Playwright isn't installed yet. The structure
 * here documents the contract so the next session can wire it up by
 * installing Playwright and dropping the `test.skip(...)` guard.
 *
 * Reference: https://playwright.dev/docs/api/class-electron
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { join } from 'node:path';

const RUN = process.env.RUN_ELECTRON_E2E === '1';

test.describe('control-dev smoke', () => {
  test.skip(!RUN, 'Set RUN_ELECTRON_E2E=1 + install deps via `npm run sandbox:install`');

  test('boots, sends a message, sees an assistant reply', async () => {
    const electronApp = await electron.launch({
      args: [join(__dirname, '..')],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        // Point at a local mock or test gateway. Never run against prod.
        NORDRISE_BACKEND_URL:
          process.env.NORDRISE_BACKEND_URL ?? 'http://localhost:13000',
      },
    });

    const window = await electronApp.firstWindow();

    // First boot may show TokenLogin; if a token is pre-seeded via the
    // keychain or env, we go straight to the AppShell. Wait for either.
    await Promise.race([
      window.waitForSelector('[data-testid="composer"]', { timeout: 30_000 }),
      window.waitForSelector('[data-testid="token-login"]', { timeout: 30_000 }),
    ]);

    // If TokenLogin appeared, paste a test token. The mock backend should
    // accept the env-provided value.
    const loginVisible = await window
      .locator('[data-testid="token-login"]')
      .isVisible()
      .catch(() => false);
    if (loginVisible) {
      const token = process.env.E2E_CONTROL_TOKEN;
      test.skip(!token, 'E2E_CONTROL_TOKEN must be set for a fresh keychain');
      await window.fill('[data-testid="token-input"]', token!);
      await window.click('[data-testid="token-submit"]');
      await window.waitForSelector('[data-testid="composer"]', { timeout: 30_000 });
    }

    // Send a deterministic prompt. The mock backend is expected to reply
    // with the SSE frames thinking → partial("hei") → done.
    await window.fill('[data-testid="composer-textarea"]', 'ping');
    await window.click('[data-testid="composer-send"]');

    // Wait for at least one assistant message bubble to render.
    const assistantMessage = window.locator(
      '[data-testid="message"][data-role="assistant"]',
    );
    await expect(assistantMessage.first()).toBeVisible({ timeout: 30_000 });
    await expect(assistantMessage.first()).toContainText(/.+/);

    await electronApp.close();
  });
});
