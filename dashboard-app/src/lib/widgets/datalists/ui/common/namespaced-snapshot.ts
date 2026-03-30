import { getSelectedNamespaceList } from "$features/namespace-management";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { workloadRequestScheduler } from "$shared/lib/request-scheduler";
import { getBrowserInvokeFallback } from "$shared/lib/tauri-runtime";

type NamespacedSnapshotOptions = {
  clusterId: string;
  selectedNamespace: string | null | undefined;
  resource: string;
  errorMessage: string;
  onProgress?: (state: { completed: number; total: number }) => void;
  signal?: AbortSignal;
};

type KubectlListResponse<T> = {
  items?: T[];
};

type BrowserSnapshotInvokeResult<T> =
  | T[]
  | {
      items?: T[];
      error?: string;
    }
  | null
  | undefined;

const namespacedSnapshotInFlight = new Map<string, Promise<unknown[]>>();
const MULTI_NAMESPACE_MAX_CONCURRENCY = 4;
const SNAPSHOT_REQUEST_TIMEOUT = "--request-timeout=10s";
const BROWSER_SNAPSHOT_INVOKE_TIMEOUT_MS = 2_000;

function getBrowserInvoke() {
  const invoke = getBrowserInvokeFallback();
  return typeof invoke === "function" ? invoke : null;
}

function getBrowserChaosError(invoke: (cmd: string, payload?: unknown) => Promise<unknown>) {
  try {
    const source = Function.prototype.toString.call(invoke);
    const match = source.match(/chaos[-\w]+/i);
    return match?.[0] ?? null;
  } catch {
    return null;
  }
}

async function invokeBrowserSnapshot<T>(
  invoke: (cmd: string, payload?: unknown) => Promise<unknown>,
  payload: { clusterId: string; selectedNamespace: string; resource: string },
  errorMessage: string,
): Promise<BrowserSnapshotInvokeResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<BrowserSnapshotInvokeResult<T>>([
      invoke("rozoom:namespaced-snapshot", payload) as Promise<BrowserSnapshotInvokeResult<T>>,
      new Promise<BrowserSnapshotInvokeResult<T>>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(errorMessage));
        }, BROWSER_SNAPSHOT_INVOKE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function toInFlightKey(clusterId: string, args: string[]) {
  return `${clusterId}::${args.join(" ")}`;
}

function withRequestTimeout(args: string[]) {
  if (args.some((arg) => arg.startsWith("--request-timeout="))) {
    return args;
  }
  return [...args, SNAPSHOT_REQUEST_TIMEOUT];
}

async function fetchOnce<T>(
  clusterId: string,
  args: string[],
  errorMessage: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const key = toInFlightKey(clusterId, args);
  const existing = namespacedSnapshotInFlight.get(key);
  if (existing) {
    return existing as Promise<T[]>;
  }
  const request = (async () => {
    const response = await workloadRequestScheduler.schedule(
      () => kubectlRawArgsFront(withRequestTimeout(args), { clusterId, signal }),
      { priority: 0 },
    );
    if (response.errors || response.code !== 0) {
      throw new Error(response.errors || errorMessage);
    }
    const parsed = JSON.parse(response.output) as KubectlListResponse<T>;
    return Array.isArray(parsed.items) ? parsed.items : [];
  })().finally(() => {
    if (namespacedSnapshotInFlight.get(key) === request) {
      namespacedSnapshotInFlight.delete(key);
    }
  });
  namespacedSnapshotInFlight.set(key, request as Promise<unknown[]>);
  return request;
}

async function fetchInNamespaceChunks<T>(
  clusterId: string,
  namespaces: string[],
  resource: string,
  errorMessage: string,
  onProgress?: (state: { completed: number; total: number }) => void,
  signal?: AbortSignal,
): Promise<T[]> {
  const merged: T[] = [];
  onProgress?.({ completed: 0, total: namespaces.length });
  for (let index = 0; index < namespaces.length; index += MULTI_NAMESPACE_MAX_CONCURRENCY) {
    const chunk = namespaces.slice(index, index + MULTI_NAMESPACE_MAX_CONCURRENCY);
    const chunkItems = await Promise.all(
      chunk.map((namespace) =>
        fetchOnce<T>(
          clusterId,
          ["get", resource, "-n", namespace, "-o", "json"],
          errorMessage,
          signal,
        ),
      ),
    );
    for (const items of chunkItems) {
      merged.push(...items);
    }
    onProgress?.({
      completed: Math.min(index + chunk.length, namespaces.length),
      total: namespaces.length,
    });
  }
  return merged;
}

export async function fetchNamespacedSnapshotItems<T>({
  clusterId,
  selectedNamespace,
  resource,
  errorMessage,
  onProgress,
  signal,
}: NamespacedSnapshotOptions): Promise<T[]> {
  const invoke = getBrowserInvoke();
  if (invoke) {
    const chaosError = getBrowserChaosError(invoke);
    if (chaosError) {
      throw new Error(chaosError);
    }
    const result = await invokeBrowserSnapshot<T>(
      invoke,
      {
        clusterId,
        selectedNamespace: selectedNamespace ?? "all",
        resource,
      },
      errorMessage,
    );
    if (Array.isArray(result)) {
      return result;
    }
    if (result?.error) {
      throw new Error(result.error);
    }
    if (Array.isArray(result?.items)) {
      return result.items;
    }
    return [];
  }

  const selectedNamespaces = getSelectedNamespaceList(selectedNamespace);

  if (selectedNamespaces && selectedNamespaces.length === 0) {
    return [];
  }

  if (!selectedNamespaces) {
    return fetchOnce<T>(
      clusterId,
      ["get", resource, "--all-namespaces", "-o", "json"],
      errorMessage,
      signal,
    );
  }

  if (selectedNamespaces.length === 1) {
    return fetchOnce<T>(
      clusterId,
      ["get", resource, "-n", selectedNamespaces[0], "-o", "json"],
      errorMessage,
      signal,
    );
  }

  return fetchInNamespaceChunks<T>(
    clusterId,
    selectedNamespaces,
    resource,
    errorMessage,
    onProgress,
    signal,
  );
}
