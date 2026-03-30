import { acquireKubeApiProxy, releaseKubeApiProxy } from "./kube-api-proxy";

export type KubernetesListResponse<T> = {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    resourceVersion?: string;
    continue?: string;
  };
  items?: T[];
};

export type KubernetesWatchEvent<T> = {
  type: "ADDED" | "MODIFIED" | "DELETED" | "BOOKMARK" | "ERROR";
  object: T;
};

type ListResourceOptions = {
  clusterId: string;
  path: string;
  signal?: AbortSignal;
};

type WatchResourceOptions<T> = {
  clusterId: string;
  path: string;
  resourceVersion: string;
  signal?: AbortSignal;
  timeoutSeconds?: number;
  sendInitialEvents?: boolean;
  onEvent: (event: KubernetesWatchEvent<T>) => void;
};

function buildUrl(baseUrl: string, path: string, query?: URLSearchParams) {
  const suffix = query && Array.from(query.keys()).length > 0 ? `?${query.toString()}` : "";
  return `${baseUrl}${path}${suffix}`;
}

function splitJsonLines(buffer: string) {
  const parts = buffer.split("\n");
  return {
    lines: parts.slice(0, -1),
    remainder: parts.at(-1) ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export async function listKubeResource<Item>(
  options: ListResourceOptions,
): Promise<{ items: Item[]; resourceVersion: string }> {
  const baseUrl = await acquireKubeApiProxy(options.clusterId);
  try {
    const response = await fetch(buildUrl(baseUrl, options.path), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`Kubernetes list HTTP ${response.status} for ${options.path}`);
    }

    const payload = (await response.json()) as KubernetesListResponse<Item>;
    return {
      items: Array.isArray(payload.items) ? payload.items : [],
      resourceVersion: payload.metadata?.resourceVersion ?? "",
    };
  } finally {
    await releaseKubeApiProxy(options.clusterId);
  }
}

export async function watchKubeResource<T>(options: WatchResourceOptions<T>) {
  const baseUrl = await acquireKubeApiProxy(options.clusterId);
  const query = new URLSearchParams({
    watch: "1",
    allowWatchBookmarks: "true",
    resourceVersion: options.resourceVersion,
    timeoutSeconds: String(options.timeoutSeconds ?? 300),
  });
  if (options.resourceVersion) {
    query.set("resourceVersionMatch", "NotOlderThan");
  }
  if (options.sendInitialEvents) {
    query.set("sendInitialEvents", "true");
    query.set("resourceVersionMatch", "NotOlderThan");
  }

  try {
    const response = await fetch(buildUrl(baseUrl, options.path, query), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: options.signal,
    });

    if (response.status === 410) {
      return { expired: true as const, resourceVersion: options.resourceVersion };
    }
    if (!response.ok) {
      throw new Error(`Kubernetes watch HTTP ${response.status} for ${options.path}`);
    }
    if (!response.body) {
      throw new Error(`Kubernetes watch stream unavailable for ${options.path}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let latestResourceVersion = options.resourceVersion;

    while (!options.signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { lines, remainder } = splitJsonLines(buffer);
      buffer = remainder;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = JSON.parse(trimmed) as KubernetesWatchEvent<T>;
        if (
          event.type === "ERROR" &&
          (event.object as { code?: number } | undefined)?.code === 410
        ) {
          return { expired: true as const, resourceVersion: latestResourceVersion };
        }
        const nextRv =
          (event.object as { metadata?: { resourceVersion?: string } } | undefined)?.metadata
            ?.resourceVersion ?? latestResourceVersion;
        latestResourceVersion = nextRv;
        options.onEvent(event);
      }
    }

    const trailing = buffer.trim();
    if (trailing) {
      const event = JSON.parse(trailing) as KubernetesWatchEvent<T>;
      if (event.type === "ERROR" && (event.object as { code?: number } | undefined)?.code === 410) {
        return { expired: true as const, resourceVersion: latestResourceVersion };
      }
      const nextRv =
        (event.object as { metadata?: { resourceVersion?: string } } | undefined)?.metadata
          ?.resourceVersion ?? latestResourceVersion;
      latestResourceVersion = nextRv;
      options.onEvent(event);
    }

    return { expired: false as const, resourceVersion: latestResourceVersion };
  } finally {
    await releaseKubeApiProxy(options.clusterId);
  }
}
