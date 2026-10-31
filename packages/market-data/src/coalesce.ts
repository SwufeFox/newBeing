const inFlight = new Map<string, Promise<unknown>>();

/* A failed read is remembered briefly. Without this, a polling caller re-issues
   a request that is already known to fail — each attempt paying the full socket
   timeout — which turns a venue outage into a retry storm. The key is only
   blocked after a real attempt fails, so a recovery is noticed within one
   cooldown window. */
const failures = new Map<string, { until: number; failedAt: number; failures: number; message: string }>();

const BASE_COOLDOWN_MS = 2_000;
const MAX_COOLDOWN_MS = 30_000;
const FAILURE_STATE_TTL_MS = 5 * 60_000;
const MAX_FAILURE_KEYS = 512;

function cooldownFor(attempt: number): number {
  return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** Math.min(attempt - 1, 4));
}

function pruneFailures(now: number, keepKey: string): void {
  for (const [key, failure] of failures) {
    if (now - failure.failedAt > FAILURE_STATE_TTL_MS) failures.delete(key);
  }
  while (failures.size >= MAX_FAILURE_KEYS) {
    const oldest = failures.keys().next();
    if (oldest.done) break;
    if (oldest.value === keepKey) {
      const next = failures.keys();
      next.next();
      const candidate = next.next();
      if (candidate.done) break;
      failures.delete(candidate.value);
    } else {
      failures.delete(oldest.value);
    }
  }
}

/** Share identical concurrent reads while allowing later refreshes to fetch new data. */
export function coalesceRequest<T>(key: string, request: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const blocked = failures.get(key);
  if (blocked?.until !== undefined && blocked.until > now) return Promise.reject(new Error(blocked.message));
  if (blocked && now - blocked.failedAt > FAILURE_STATE_TTL_MS) failures.delete(key);

  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const attempt = (failures.get(key)?.failures ?? 0) + 1;
  const pending = request().then(
    (value) => {
      failures.delete(key);
      return value;
    },
    (reason: unknown) => {
      const failedAt = Date.now();
      pruneFailures(failedAt, key);
      failures.delete(key);
      failures.set(key, {
        failures: attempt,
        failedAt,
        until: failedAt + cooldownFor(attempt),
        message: reason instanceof Error ? reason.message : String(reason),
      });
      throw reason;
    },
  ).finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });

  inFlight.set(key, pending);
  return pending;
}

/** Test seam: drop all cached failures so a fresh process starts clean. */
export function resetRequestFailures(): void {
  failures.clear();
}
