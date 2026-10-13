const inFlight = new Map<string, Promise<unknown>>();

/** Share identical concurrent reads while allowing later refreshes to fetch new data. */
export function coalesceRequest<T>(key: string, request: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const pending = request().finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}
