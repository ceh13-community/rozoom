import { createRequestCoalescer } from "$shared/lib/request-coalescer";

const coalescer = createRequestCoalescer();

export function dedupePodsRequest<T>(
  kind: string,
  scopeKey: string,
  request: () => Promise<T>,
): Promise<T> {
  const key = `${kind}:${scopeKey}`;
  return coalescer.run(key, request);
}

export function clearPodsRequestDedupeForTests() {
  coalescer.clear();
}
