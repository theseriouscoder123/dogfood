// When to try a failed delivery again, and when to give up on an endpoint. Pure, so it's unit-tested.

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Wait after the 1st, 2nd, … failed attempt. Eight attempts span about 45 hours. */
export const RETRY_DELAYS_MS = [1 * MIN, 5 * MIN, 30 * MIN, 2 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** An endpoint is switched off after this many failed attempts in a row… */
export const DISABLE_AFTER_FAILURES = 5;
/** …that have been going on for at least this long, so a short outage never disables anything. */
export const DISABLE_AFTER_FAILING_FOR_MS = 24 * HOUR;

export const isSuccess = (status: number | null) => status !== null && status >= 200 && status < 300;

/**
 * After a failed attempt: when to retry, or null to give up. ±10% jitter spreads out the retries
 * of many deliveries that failed together, so a recovering endpoint isn't hit all at once.
 */
export function nextAttemptAt(attemptsMade: number, now: Date, random: () => number = Math.random): Date | null {
  if (attemptsMade >= MAX_ATTEMPTS) return null;
  const base = RETRY_DELAYS_MS[attemptsMade - 1]!;
  return new Date(now.getTime() + Math.round(base * (0.9 + 0.2 * random())));
}

export type EndpointHealth = { consecutiveFailures: number; failingSince: Date | null };

/** The endpoint's failure streak after one attempt, and whether to switch it off. 410 Gone means "stop" right away. */
export function afterAttempt(h: EndpointHealth, status: number | null, now: Date): EndpointHealth & { disable: string | null } {
  if (isSuccess(status)) return { consecutiveFailures: 0, failingSince: null, disable: null };
  const next = { consecutiveFailures: h.consecutiveFailures + 1, failingSince: h.failingSince ?? now };
  if (status === 410) return { ...next, disable: "The endpoint answered 410 Gone." };
  const longEnough = now.getTime() - next.failingSince.getTime() >= DISABLE_AFTER_FAILING_FOR_MS;
  if (next.consecutiveFailures >= DISABLE_AFTER_FAILURES && longEnough) {
    return { ...next, disable: `${next.consecutiveFailures} failed attempts in a row since ${next.failingSince.toISOString()}.` };
  }
  return { ...next, disable: null };
}
