import { kubectlJson, kubectlRawFront } from "./kubectl-proxy";
import type { KubectlVersion } from "../model/metrics";
import type {
  ClusterItemsData,
  DaemonSets,
  Deployments,
  NamespaceData,
  Pods,
  ServicesData,
} from "../model/clusters";

export type ClusterEntityInfoResult =
  | { entity: string; data: unknown; status: "ok"; error?: undefined }
  | { entity: string; data: string; status: "error"; error: string };

export type FastDashboardEntityCollection = {
  items: Array<{ metadata: { namespace: string; name: string } }>;
};

export type FastDashboardEntities = {
  pods: FastDashboardEntityCollection;
  deployments: FastDashboardEntityCollection;
  replicasets: FastDashboardEntityCollection;
};

export type SlowDashboardEntities = {
  daemonsets: FastDashboardEntityCollection;
  statefulsets: FastDashboardEntityCollection;
  jobs: FastDashboardEntityCollection;
  cronjobs: FastDashboardEntityCollection;
};

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isConnectivityError(message: string) {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("no route to host") ||
    normalized.includes("connection refused") ||
    normalized.includes("i/o timeout") ||
    normalized.includes("context deadline exceeded") ||
    normalized.includes("unable to connect to the server") ||
    normalized.includes("dial tcp")
  );
}

export async function getClientKubectlVersion(): Promise<KubectlVersion | string> {
  return kubectlJson("version --client=true --output=json");
}

export async function getClusterNodesNames(clusterId: string) {
  const json = await kubectlJson(`get nodes --all-namespaces`, {
    clusterId,
  });

  if (typeof json === "string") return [];

  return (json as ClusterItemsData).items.map((item) => item.metadata.name);
}

export async function getClusterServices(clusterId: string, namespace?: string) {
  const json = await kubectlJson(
    `get services ${namespace ? `-n ${namespace}` : "--all-namespaces"}`,
    {
      clusterId,
    },
  );

  if (typeof json === "string") return null;

  return json as ServicesData;
}

export async function getClusterDaemonsets(clusterId: string, namespace?: string) {
  const json = await kubectlJson(
    `get daemonsets ${namespace ? `-n ${namespace}` : "--all-namespaces"}`,
    {
      clusterId,
    },
  );

  if (typeof json === "string") return null;

  return json as DaemonSets;
}

export async function getClusterEntityInfo(
  entity: string,
  clusterId: string,
  timeoutMs?: number,
  signal?: AbortSignal,
  options?: { lightweight?: boolean },
): Promise<ClusterEntityInfoResult> {
  const effectiveTimeoutMs =
    typeof timeoutMs === "number"
      ? timeoutMs
      : entity === "secrets"
        ? 25000
        : entity === "configmaps"
          ? 15000
          : 10000;
  const runEntityCall = async () => {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;
    const abortState: { reason: "abort" | "timeout" | null } = { reason: null };
    const timeoutMessage = `Timeout after ${effectiveTimeoutMs}ms for ${entity}`;
    const onAbort = () => {
      abortState.reason = "abort";
      controller.abort();
    };

    try {
      if (signal?.aborted) {
        throw new DOMException("Entity request aborted", "AbortError");
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      const command = buildEntityCommand(entity, options?.lightweight === true);
      const resultPromise = kubectlRawFront(command, {
        clusterId,
        signal: controller.signal,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortState.reason = "timeout";
          controller.abort();
          reject(new Error(timeoutMessage));
        }, effectiveTimeoutMs);
      });
      const result = await Promise.race([resultPromise, timeoutPromise]);
      const typedResult = result as { output: string; errors: string; code?: number };
      if (typedResult.errors.length > 0 || typedResult.code !== 0) {
        const message = typedResult.errors || typedResult.output || `Failed to load ${entity}`;
        return {
          entity,
          data: message,
          status: "error" as const,
          error: message,
        };
      }

      const parsed = options?.lightweight
        ? parseLightweightEntityOutput(entity, typedResult.output)
        : safeJsonParse(typedResult.output);
      if (!parsed) {
        return {
          entity,
          data: `Failed to parse kubectl JSON output for ${entity}`,
          status: "error" as const,
          error: `Failed to parse kubectl JSON output for ${entity}`,
        };
      }

      return {
        entity,
        data: parsed,
        status: "ok" as const,
      };
    } catch (error) {
      if (abortState.reason === "abort") {
        throw new DOMException("Entity request aborted", "AbortError");
      }
      if (abortState.reason === "timeout") {
        throw new Error(timeoutMessage);
      }
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    }
  };

  try {
    try {
      return await runEntityCall();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = message.includes("Timeout after");
      if (!isTimeout || isConnectivityError(message)) {
        throw error;
      }
      // Retry once to absorb transient API-server slowness for large resources.
      return await runEntityCall();
    }
  } catch (error) {
    return {
      entity,
      data: "",
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getClusterFastDashboardEntities(
  clusterId: string,
  signal?: AbortSignal,
  timeoutMs = 10000,
): Promise<FastDashboardEntities> {
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | undefined;
  const onAbort = () => {
    controller.abort();
  };

  try {
    if (signal?.aborted) {
      throw new DOMException("Dashboard workload summary aborted", "AbortError");
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    const resultPromise = kubectlRawFront(
      "get pods,deployments,replicasets --all-namespaces --no-headers -o custom-columns=KIND:.kind,NAMESPACE:.metadata.namespace,NAME:.metadata.name",
      {
        clusterId,
        signal: controller.signal,
      },
    );
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error(`Timeout after ${timeoutMs}ms for dashboard workload summary`));
      }, timeoutMs);
    });
    const result = await Promise.race([resultPromise, timeoutPromise]);
    const typedResult = result as { output: string; errors: string; code?: number };
    if (typedResult.errors.length > 0 || typedResult.code !== 0) {
      throw new Error(
        typedResult.errors || typedResult.output || "Failed to load dashboard workload summary",
      );
    }

    return parseCombinedDashboardEntityOutput(typedResult.output);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function getClusterSlowDashboardEntities(
  clusterId: string,
  signal?: AbortSignal,
  timeoutMs = 10000,
): Promise<SlowDashboardEntities> {
  const controller = new AbortController();
  let timeoutId: NodeJS.Timeout | undefined;
  const onAbort = () => {
    controller.abort();
  };

  try {
    if (signal?.aborted) {
      throw new DOMException("Dashboard slow entity summary aborted", "AbortError");
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    const resultPromise = kubectlRawFront(
      "get daemonsets,statefulsets,jobs,cronjobs --all-namespaces --no-headers -o custom-columns=KIND:.kind,NAMESPACE:.metadata.namespace,NAME:.metadata.name",
      {
        clusterId,
        signal: controller.signal,
      },
    );
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error(`Timeout after ${timeoutMs}ms for dashboard slow entity summary`));
      }, timeoutMs);
    });
    const result = await Promise.race([resultPromise, timeoutPromise]);
    const typedResult = result as { output: string; errors: string; code?: number };
    if (typedResult.errors.length > 0 || typedResult.code !== 0) {
      throw new Error(
        typedResult.errors || typedResult.output || "Failed to load dashboard slow entity summary",
      );
    }

    return parseCombinedSlowDashboardEntityOutput(typedResult.output);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

function buildEntityCommand(entity: string, lightweight: boolean) {
  if (!lightweight) {
    return `get ${entity} --all-namespaces -o json`;
  }

  if (entity === "nodes") {
    return 'get nodes --no-headers -o custom-columns=NAME:.metadata.name,READY:.status.conditions[?(@.type=="Ready")].status,DISK:.status.conditions[?(@.type=="DiskPressure")].status,MEMORY:.status.conditions[?(@.type=="MemoryPressure")].status,PID:.status.conditions[?(@.type=="PIDPressure")].status,NETWORK:.status.conditions[?(@.type=="NetworkUnavailable")].status';
  }

  if (entity === "namespaces") {
    return "get namespaces --no-headers -o custom-columns=NAME:.metadata.name";
  }

  return `get ${entity} --all-namespaces --no-headers -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name`;
}

function parseLightweightEntityOutput(entity: string, output: string) {
  const trimmed = output.trim();
  if (!trimmed) {
    return { items: [] };
  }

  const items = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const columns = line.split(/\s+/);
      if (entity === "nodes") {
        const [name, ready, diskPressure, memoryPressure, pidPressure, networkUnavailable] =
          columns;
        const conditions = [
          ["Ready", ready],
          ["DiskPressure", diskPressure],
          ["MemoryPressure", memoryPressure],
          ["PIDPressure", pidPressure],
          ["NetworkUnavailable", networkUnavailable],
        ]
          .filter(([, status]) => Boolean(status) && status !== "<none>")
          .map(([type, status]) => ({ type, status }));

        return {
          metadata: { name },
          status: { conditions },
        };
      }

      if (entity === "namespaces") {
        const [name] = columns;
        return { metadata: { name } };
      }

      const [namespace, name] = columns;
      return { metadata: { namespace, name } };
    });

  return { items };
}

function parseCombinedDashboardEntityOutput(output: string) {
  const parsed = {
    pods: { items: [] as Array<{ metadata: { namespace: string; name: string } }> },
    deployments: { items: [] as Array<{ metadata: { namespace: string; name: string } }> },
    replicasets: { items: [] as Array<{ metadata: { namespace: string; name: string } }> },
  };

  const trimmed = output.trim();
  if (!trimmed) return parsed;

  for (const line of trimmed
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const [kindRaw, namespace, name] = line.split(/\s+/);
    const item = { metadata: { namespace, name } };
    switch (kindRaw.toLowerCase()) {
      case "pod":
        parsed.pods.items.push(item);
        break;
      case "deployment":
        parsed.deployments.items.push(item);
        break;
      case "replicaset":
        parsed.replicasets.items.push(item);
        break;
      default:
        break;
    }
  }

  return parsed;
}

export function parseCombinedSlowDashboardEntityOutput(output: string): SlowDashboardEntities {
  const parsed: SlowDashboardEntities = {
    daemonsets: { items: [] as Array<{ metadata: { namespace: string; name: string } }> },
    statefulsets: { items: [] as Array<{ metadata: { namespace: string; name: string } }> },
    jobs: { items: [] as Array<{ metadata: { namespace: string; name: string } }> },
    cronjobs: { items: [] as Array<{ metadata: { namespace: string; name: string } }> },
  };

  const trimmed = output.trim();
  if (!trimmed) return parsed;

  for (const line of trimmed
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const [kindRaw, namespace, name] = line.split(/\s+/);
    const item = { metadata: { namespace, name } };
    switch (kindRaw.toLowerCase()) {
      case "daemonset":
        parsed.daemonsets.items.push(item);
        break;
      case "statefulset":
        parsed.statefulsets.items.push(item);
        break;
      case "job":
        parsed.jobs.items.push(item);
        break;
      case "cronjob":
        parsed.cronjobs.items.push(item);
        break;
      default:
        break;
    }
  }

  return parsed;
}

export async function getNodeMetrics(
  clusterId: string,
): Promise<{ name: string; cpu: string; memory: string }[]> {
  const raw = await kubectlRawFront("top nodes", { clusterId });

  if (!raw.output.length) return [];

  const lines = raw.output.trim().split("\n");
  lines.shift(); // remove header

  return lines.map((line) => {
    const [name, , cpu, , memory] = line.trim().split(/\s+/);
    return { name, cpu, memory };
  });
}

export async function getNamespaces(clusterId: string) {
  const raw = await kubectlJson<NamespaceData>(`get namespaces`, {
    clusterId,
  });

  if (typeof raw === "string") return [];

  return raw.items.map((item) => item.metadata.name);
}

export async function getAllNamespaces(clusterId: string) {
  const raw = await kubectlJson<NamespaceData>(`get namespaces --all-namespaces`, {
    clusterId,
  });

  if (typeof raw === "string") return [];

  return Array.isArray(raw.items) ? raw.items.map((item) => item.metadata.name) : [];
}

export async function getAllPods(clusterId: string) {
  const raw = await kubectlJson(`get pods --all-namespaces`, {
    clusterId,
  });

  if (typeof raw === "string") return [];

  return Array.isArray((raw as Pods).items) ? (raw as Pods).items : [];
}

export async function getPods(slug: string, clusterId: string, namespace?: string) {
  if (namespace && namespace !== "all")
    return (await kubectlJson(`get pods -n ${namespace} --context=${slug}`, {
      clusterId,
    })) as Pods;

  return (await kubectlJson(`get pods --all-namespaces --context=${slug}`, {
    clusterId,
  })) as Pods;
}

export async function getDeployments(clusterId: string) {
  return (await kubectlJson(`get deployments`, {
    clusterId,
  })) as Deployments;
}

export async function getStatefulSets(slug: string, clusterId: string, namespace?: string) {
  if (namespace && namespace !== "all")
    return (await kubectlJson(`get statefulsets -n ${namespace} --context=${slug}`, {
      clusterId,
    })) as ClusterItemsData;

  return (await kubectlJson(`get statefulsets --all-namespaces --context=${slug}`, {
    clusterId,
  })) as ClusterItemsData;
}

export async function getReplicaSets(slug: string, clusterId: string, namespace?: string) {
  if (namespace && namespace !== "all")
    return (await kubectlJson(`get replicasets -n ${namespace} --context=${slug}`, {
      clusterId,
    })) as ClusterItemsData;

  return (await kubectlJson(`get replicasets --all-namespaces --context=${slug}`, {
    clusterId,
  })) as ClusterItemsData;
}

export async function getReplicationControllers(
  slug: string,
  clusterId: string,
  namespace?: string,
) {
  if (namespace && namespace !== "all")
    return (await kubectlJson(`get replicationcontrollers -n ${namespace} --context=${slug}`, {
      clusterId,
    })) as ClusterItemsData;

  return (await kubectlJson(`get replicationcontrollers --all-namespaces --context=${slug}`, {
    clusterId,
  })) as ClusterItemsData;
}

export async function getJobs(slug: string, clusterId: string, namespace?: string) {
  if (namespace && namespace !== "all")
    return (await kubectlJson(`get jobs -n ${namespace} --context=${slug}`, {
      clusterId,
    })) as ClusterItemsData;

  return (await kubectlJson(`get jobs --all-namespaces --context=${slug}`, {
    clusterId,
  })) as ClusterItemsData;
}

export async function getCronJobs(slug: string, clusterId: string, namespace?: string) {
  if (namespace && namespace !== "all")
    return (await kubectlJson(`get cronjobs -n ${namespace} --context=${slug}`, {
      clusterId,
    })) as ClusterItemsData;

  return (await kubectlJson(`get cronjobs --all-namespaces --context=${slug}`, {
    clusterId,
  })) as ClusterItemsData;
}
