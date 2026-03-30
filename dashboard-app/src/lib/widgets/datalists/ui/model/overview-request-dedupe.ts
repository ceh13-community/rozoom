import { createRequestCoalescer } from "$shared/lib/request-coalescer";

const coalescer = createRequestCoalescer();

export function dedupeOverviewRequest<T>(
  kind: string,
  scopeKey: string,
  request: () => Promise<T>,
): Promise<T> {
  const key = `${kind}:${scopeKey}`;
  return coalescer.run(key, request);
}

export function clearOverviewRequestDedupeForTests() {
  coalescer.clear();
}
