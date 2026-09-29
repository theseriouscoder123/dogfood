// A fixed-window request counter kept in memory. Good enough for one API process (the shipped
// docker setup); a multi-instance deployment would move this to Redis or the gateway.

export type LimitResult = { allowed: boolean; limit: number; remaining: number; resetSeconds: number };

export class FixedWindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): LimitResult {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      if (this.windows.size > 10_000) this.sweep(t);
      w = { start: t, count: 0 };
      this.windows.set(key, w);
    }
    w.count++;
    return {
      allowed: w.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - w.count),
      resetSeconds: Math.max(1, Math.ceil((w.start + this.windowMs - t) / 1000)),
    };
  }

  /** Has this key used up its window, without counting another hit? */
  exhausted(key: string): LimitResult | null {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs || w.count < this.limit) return null;
    return { allowed: false, limit: this.limit, remaining: 0, resetSeconds: Math.max(1, Math.ceil((w.start + this.windowMs - t) / 1000)) };
  }

  private sweep(t: number) {
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
  }
}
