import { describe, it, expect } from 'vitest';
import { parseControlTokens } from './config.js';

describe('parseControlTokens', () => {
  it('returns empty array for undefined', () => {
    expect(parseControlTokens(undefined)).toEqual([]);
  });
  it('returns empty array for empty string', () => {
    expect(parseControlTokens('')).toEqual([]);
  });
  it('parses single token', () => {
    expect(parseControlTokens('abc123')).toEqual(['abc123']);
  });
  it('parses multiple comma-separated tokens trimmed', () => {
    expect(parseControlTokens('a , b ,c')).toEqual(['a', 'b', 'c']);
  });
  it('drops empty entries', () => {
    expect(parseControlTokens(',a,, ,b,')).toEqual(['a', 'b']);
  });
});
