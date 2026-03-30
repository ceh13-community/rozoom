export async function withAbortableLatestOnly<T>(
  run: (signal: AbortSignal) => Promise<T>,
  controllerRef: { current: AbortController | null },
): Promise<T> {
  controllerRef.current?.abort();
  const controller = new AbortController();
  controllerRef.current = controller;
  try {
    return await run(controller.signal);
  } finally {
    if (controllerRef.current === controller) {
      controllerRef.current = null;
    }
  }
}

export function debounce<TArgs extends unknown[]>(fn: (...args: TArgs) => void, waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: TArgs) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, waitMs);
  };
}
