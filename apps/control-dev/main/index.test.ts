import { describe, it, expect } from 'vitest';
import { mainWindowOptions } from './windows.js';

describe('mainWindowOptions', () => {
  it('disables nodeIntegration and enables contextIsolation', () => {
    const opts = mainWindowOptions('/abs/preload.js');
    expect(opts.webPreferences?.nodeIntegration).toBe(false);
    expect(opts.webPreferences?.contextIsolation).toBe(true);
    expect(opts.webPreferences?.sandbox).toBe(true);
    expect(opts.webPreferences?.preload).toBe('/abs/preload.js');
  });
});
