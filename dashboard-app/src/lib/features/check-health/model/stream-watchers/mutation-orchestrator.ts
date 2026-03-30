type MutationEventType = "ADDED" | "MODIFIED" | "DELETED";

type PendingMutation = {
  token: number;
  clusterId: string;
  scopeKey: string;
  pendingIds: Set<string>;
  expectedEventTypes: Set<MutationEventType>;
  timeoutId: ReturnType<typeof setTimeout>;
};

const pendingMutations = new Map<number, PendingMutation>();
let nextToken = 1;

type BeginMutationOptions = {
  clusterId: string;
  scopeKey: string;
  ids: string[];
  expectedEventTypes: MutationEventType[];
  timeoutMs: number;
  onTimeout: () => void;
};

export function beginMutationAck(options: BeginMutationOptions) {
  const ids = options.ids.filter(Boolean);
  if (ids.length === 0) return null;

  const token = nextToken++;
  const timeoutId = setTimeout(() => {
    pendingMutations.delete(token);
    options.onTimeout();
  }, options.timeoutMs);

  pendingMutations.set(token, {
    token,
    clusterId: options.clusterId,
    scopeKey: options.scopeKey,
    pendingIds: new Set(ids),
    expectedEventTypes: new Set(options.expectedEventTypes),
    timeoutId,
  });

  return token;
}

export function acknowledgeMutationAck(
  clusterId: string,
  scopeKey: string,
  id: string,
  eventType: MutationEventType,
) {
  for (const [token, pending] of pendingMutations) {
    if (pending.clusterId !== clusterId) continue;
    if (pending.scopeKey !== scopeKey) continue;
    if (!pending.expectedEventTypes.has(eventType)) continue;
    if (!pending.pendingIds.has(id)) continue;

    pending.pendingIds.delete(id);
    if (pending.pendingIds.size === 0) {
      clearTimeout(pending.timeoutId);
      pendingMutations.delete(token);
    }
  }
}

export function cancelMutationAcksForScope(clusterId: string, scopeKey: string) {
  for (const [token, pending] of pendingMutations) {
    if (pending.clusterId !== clusterId) continue;
    if (pending.scopeKey !== scopeKey) continue;
    clearTimeout(pending.timeoutId);
    pendingMutations.delete(token);
  }
}
