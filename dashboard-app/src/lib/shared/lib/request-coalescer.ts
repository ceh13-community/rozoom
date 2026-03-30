export type RequestFactory<T> = () => Promise<T>;

export function createRequestCoalescer() {
  const inFlight = new Map<string, Promise<unknown>>();

  function run<T>(key: string, factory: RequestFactory<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = factory().finally(() => {
      if (inFlight.get(key) === promise) {
        inFlight.delete(key);
      }
    });
    inFlight.set(key, promise);
    return promise;
  }

  function clear() {
    inFlight.clear();
  }

  function size() {
    return inFlight.size;
  }

  return {
    run,
    clear,
    size,
  };
}
