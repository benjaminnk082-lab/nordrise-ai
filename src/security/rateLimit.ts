/**
 * Per-user sliding window rate limit.
 * In-memory is fine for a single-process MVP on Railway.
 */

import { config } from '../config.js';

interface Bucket {
  timestamps: number[];
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly max = config.RATE_LIMIT_MAX_MESSAGES,
    private readonly windowMs = config.RATE_LIMIT_WINDOW_MS,
  ) {}

  check(key: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { timestamps: [] };

    const cutoff = now - this.windowMs;
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

    if (bucket.timestamps.length >= this.max) {
      const oldest = bucket.timestamps[0] ?? now;
      this.buckets.set(key, bucket);
      return { allowed: false, retryAfterMs: this.windowMs - (now - oldest) };
    }

    bucket.timestamps.push(now);
    this.buckets.set(key, bucket);
    return { allowed: true, retryAfterMs: 0 };
  }
}

export const rateLimiter = new RateLimiter();
