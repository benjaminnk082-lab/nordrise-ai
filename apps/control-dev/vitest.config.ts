import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['renderer/**/*.test.ts', 'renderer/**/*.test.tsx', 'main/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['./renderer/test-setup.ts'],
  },
});
