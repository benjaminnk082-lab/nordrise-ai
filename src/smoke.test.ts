import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('node version is >= 20', () => {
    const major = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(20);
  });
});
