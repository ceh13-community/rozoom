import {
  getClusterEntityInfo,
  getClusterFastDashboardEntities,
  getClusterSlowDashboardEntities,
  type FastDashboardEntities,
} from "$shared/api/tauri";
import type { NamespaceItem } from "$shared/model/clusters";
import { debug, warn } from "@tauri-apps/plugin-log";
import {
  getFeatureCapability,
  markFeatureCapability,
  markFeatureCapabilityFromReason,
  shouldSkipFeatureProbe,
} from "../model/feature-capability-cache";
import type {
  ClusterData,
  CronJobItem,
  ConfigMapItem,
  DaemonSetItem,
  DeploymentItem,
  JobItem,
  NodeItem,
  PodItem,
  PodDisruptionBudgetItem,
  PriorityClassItem,
  NetworkPolicyItem,
  SecretItem,
  ReplicaSetItem,
  StatefulSetItem,
} from "$shared/model/clusters";

type EntityType =
  | "pods"
  | "deployments"
  | "replicasets"
  | "cronjobs"
  | "configmaps"
  | "nodes"
  | "namespaces"
  | "daemonsets"
  | "statefulsets"
  | "jobs"
  | "poddisruptionbudgets"
  | "priorityclasses"
  | "networkpolicies"
  | "secrets";

type BaseClusterData<T> = {
  items: T[];
};

type EntityDataMap = {
  pods: BaseClusterData<PodItem>;
  deployments: BaseClusterData<DeploymentItem>;
  replicasets: BaseClusterData<ReplicaSetItem>;
  cronjobs: BaseClusterData<CronJobItem>;
  configmaps: BaseClusterData<ConfigMapItem>;
  nodes: BaseClusterData<NodeItem>;
  namespaces: BaseClusterData<NamespaceItem>;
  daemonsets: BaseClusterData<DaemonSetItem>;
  statefulsets: BaseClusterData<StatefulSetItem>;
  jobs: BaseClusterData<JobItem>;
  poddisruptionbudgets: BaseClusterData<PodDisruptionBudgetItem>;
  priorityclasses: BaseClusterData<PriorityClassItem>;
  networkpolicies: BaseClusterData<NetworkPolicyItem>;
  secrets: BaseClusterData<SecretItem>;
};

type EntitySuccessResponse<E extends EntityType> = {
  data: EntityDataMap[E];
  status: "ok";
  entity: E;
  error: null;
};

type EntityErrorResponse<E extends EntityType> = {
  data: string;
  status: "error";
  entity: E;
  error: string;
};

type AnyEntityResponse = EntitySuccessResponse<EntityType> | EntityErrorResponse<EntityType>;

interface LoaderConfig<T extends EntityType = EntityType> {
  entities?: T[];
  exclude?: EntityType[];
  testEntity?: EntityType;
  failFast?: boolean;
  signal?: AbortSignal;
  lightweight?: boolean;
  maxConcurrency?: number;
}

interface ClusterIdentifier {
  uuid: string;
  name?: string;
}

type EntityResultEntry = {
  entity: EntityType;
  result: AnyEntityResponse;
};

type NormalizedLoaderConfig = {
  entities: EntityType[];
  exclude: EntityType[];
  testEntity: EntityType;
  failFast: boolean;
  signal?: AbortSignal;
  lightweight: boolean;
  maxConcurrency: number;
};

const DEFAULT_ENTITIES: EntityType[] = [
  "pods",
  "deployments",
  "replicasets",
  "cronjobs",
  "namespaces",
];

const MAX_CONCURRENT_REQUESTS = 3;

const DEFAULT_CONFIG: NormalizedLoaderConfig = {
  entities: DEFAULT_ENTITIES,
  exclude: [],
  testEntity: "nodes",
  failFast: true,
  lightweight: false,
  maxConcurrency: MAX_CONCURRENT_REQUESTS,
};

function buildEntityProbeFeatureId(entities: EntityType[]) {
  const normalized = [...new Set(entities)].sort();
  return `entity-probe:${normalized.join(",") || "minimal"}`;
}

export const loadClusterData = async (
  cluster: ClusterIdentifier,
  config: LoaderConfig = {},
): Promise<ClusterData> => {
  const cfg: NormalizedLoaderConfig = { ...DEFAULT_CONFIG, ...config };
  const requestedEntities = getEntitiesToLoad(cfg);
  const featureId = buildEntityProbeFeatureId(requestedEntities);
  await debug(`Loading data for cluster ${cluster.uuid}, with config ${JSON.stringify(cfg)}`);

  if (
    cfg.failFast &&
    shouldSkipFeatureProbe(cluster.uuid, featureId, {
      statuses: ["unsupported", "forbidden", "unreachable", "unavailable", "misconfigured"],
    })
  ) {
    const cached = getFeatureCapability(cluster.uuid, featureId);
    return createErrorResponse(
      cluster,
      cached?.reason || "Cluster entity probe skipped from cache",
    );
  }

  const useCombinedDashboardProbe =
    cfg.lightweight &&
    cfg.testEntity === "pods" &&
    requestedEntities.includes("pods") &&
    requestedEntities.includes("deployments") &&
    requestedEntities.includes("replicasets");

  // Step 1: Connection test
  let testResult: AnyEntityResponse;
  let combinedDashboardSeed: FastDashboardEntities | undefined;

  if (useCombinedDashboardProbe) {
    try {
      const combined = await getClusterFastDashboardEntities(cluster.uuid, cfg.signal);
      combinedDashboardSeed = combined;
      testResult = {
        entity: "pods",
        status: "ok",
        data: combined.pods as EntityDataMap["pods"],
        error: null,
      } as AnyEntityResponse;
    } catch (error) {
      const message = getErrorMessage(error);
      testResult = {
        entity: "pods",
        status: "error",
        data: message,
        error: message,
      };
    }
  } else {
    const rawTestResult = await getClusterEntityInfo(
      cfg.testEntity,
      cluster.uuid,
      undefined,
      cfg.signal,
      {
        lightweight: cfg.lightweight,
      },
    );
    testResult =
      rawTestResult.status === "ok"
        ? ({
            ...rawTestResult,
            entity: cfg.testEntity,
            error: null,
            data: rawTestResult.data as EntityDataMap[typeof cfg.testEntity],
          } as AnyEntityResponse)
        : ({ ...rawTestResult, entity: cfg.testEntity } as AnyEntityResponse);
  }

  if (testResult.status === "error") {
    await warn("Cluster connection failed during test. Aborting.");

    if (cfg.failFast) {
      const errorResponse = createErrorResponse(
        cluster,
        testResult.error || "Connection to cluster failed",
      );
      markFeatureCapabilityFromReason(cluster.uuid, featureId, errorResponse.errors);
      return errorResponse;
    }
  }

  // Step 2: Determine which entities to load
  const entitiesToLoad = requestedEntities.filter(
    (entity) => !(entity === cfg.testEntity && testResult.status === "ok"),
  );

  // Step 3: Load entities (parallel for lightweight, sequential for diagnostics)
  const results = await loadEntities(
    cluster.uuid,
    entitiesToLoad,
    requestedEntities,
    cfg.signal,
    cfg.lightweight,
    combinedDashboardSeed,
    testResult.status === "ok"
      ? ({
          entity: cfg.testEntity,
          result: testResult,
        } satisfies EntityResultEntry)
      : undefined,
    cfg.maxConcurrency,
  );

  // Step 4: Combine results
  const combined = combineResults(cluster, testResult, results, cfg.testEntity);

  if (combined.status === "ok") {
    markFeatureCapability(cluster.uuid, featureId, { status: "available" });
  } else {
    markFeatureCapabilityFromReason(cluster.uuid, featureId, combined.errors);
  }

  return combined;
};

function assignEntity<E extends EntityType>(
  target: Partial<ClusterData>,
  entity: E,
  value: EntityDataMap[E],
): void {
  target[entity] = value;
}

function getEntitiesToLoad(config: NormalizedLoaderConfig): EntityType[] {
  const baseEntities = config.entities;

  return Array.from(new Set(baseEntities)).filter((entity) => !config.exclude.includes(entity));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown error occurred";
}

function createErrorEntityResponse<E extends EntityType>(
  entity: E,
  error: string,
): EntityErrorResponse<E> {
  return {
    data: error,
    status: "error",
    error: error,
    entity,
  };
}

async function loadEntities(
  clusterUuid: string,
  entities: EntityType[],
  requestedEntities: EntityType[],
  signal?: AbortSignal,
  lightweight = false,
  combinedDashboardSeed?: FastDashboardEntities,
  successfulTestResult?: EntityResultEntry,
  maxConcurrency = 3,
): Promise<Map<EntityType, AnyEntityResponse>> {
  if (entities.length === 0) {
    return new Map();
  }

  const map = new Map<EntityType, AnyEntityResponse>();
  let remainingEntities = [...entities];
  const canUseCombinedDashboardQuery =
    lightweight &&
    requestedEntities.includes("pods") &&
    requestedEntities.includes("deployments") &&
    requestedEntities.includes("replicasets");

  if (canUseCombinedDashboardQuery) {
    try {
      const combined =
        combinedDashboardSeed ?? (await getClusterFastDashboardEntities(clusterUuid, signal));
      if (successfulTestResult?.entity === "pods" && successfulTestResult.result.status === "ok") {
        map.set("pods", successfulTestResult.result);
      } else if (requestedEntities.includes("pods")) {
        map.set("pods", {
          entity: "pods",
          status: "ok",
          error: null,
          data: combined.pods as EntityDataMap["pods"],
        });
      }
      map.set("deployments", {
        entity: "deployments",
        status: "ok",
        error: null,
        data: combined.deployments as EntityDataMap["deployments"],
      });
      map.set("replicasets", {
        entity: "replicasets",
        status: "ok",
        error: null,
        data: combined.replicasets as EntityDataMap["replicasets"],
      });
      remainingEntities = remainingEntities.filter(
        (entity) => entity !== "pods" && entity !== "deployments" && entity !== "replicasets",
      );
    } catch (err) {
      if (requestedEntities.includes("pods")) {
        const error = createErrorEntityResponse("pods", getErrorMessage(err));
        map.set("pods", error);
      }
      map.set("deployments", createErrorEntityResponse("deployments", getErrorMessage(err)));
      map.set("replicasets", createErrorEntityResponse("replicasets", getErrorMessage(err)));
      remainingEntities = remainingEntities.filter(
        (entity) => entity !== "pods" && entity !== "deployments" && entity !== "replicasets",
      );
    }
  }

  type SlowEntityType = "daemonsets" | "statefulsets" | "jobs" | "cronjobs";
  const slowEntityTypes: SlowEntityType[] = ["daemonsets", "statefulsets", "jobs", "cronjobs"];
  const canUseCombinedSlowDashboardQuery =
    lightweight && slowEntityTypes.some((e) => requestedEntities.includes(e));

  if (canUseCombinedSlowDashboardQuery) {
    try {
      const combined = await getClusterSlowDashboardEntities(clusterUuid, signal);
      for (const entityType of slowEntityTypes) {
        if (requestedEntities.includes(entityType)) {
          map.set(entityType, {
            entity: entityType,
            status: "ok",
            error: null,
            data: combined[entityType] as EntityDataMap[typeof entityType],
          });
        }
      }
      remainingEntities = remainingEntities.filter(
        (entity) => !(slowEntityTypes as readonly EntityType[]).includes(entity),
      );
    } catch (err) {
      for (const entityType of slowEntityTypes) {
        if (requestedEntities.includes(entityType)) {
          map.set(entityType, createErrorEntityResponse(entityType, getErrorMessage(err)));
        }
      }
      remainingEntities = remainingEntities.filter(
        (entity) => !(slowEntityTypes as readonly EntityType[]).includes(entity),
      );
    }
  }

  const settled = await runWithConcurrencyLimit(
    remainingEntities,
    maxConcurrency,
    async (entity): Promise<EntityResultEntry> => {
      try {
        const rawResult = await getClusterEntityInfo(entity, clusterUuid, undefined, signal, {
          lightweight,
        });
        const result =
          rawResult.status === "ok"
            ? ({ ...rawResult, entity, error: null } as AnyEntityResponse)
            : ({ ...rawResult, entity } as AnyEntityResponse);
        return { entity, result };
      } catch (err) {
        return {
          entity,
          result: createErrorEntityResponse(entity, getErrorMessage(err)),
        };
      }
    },
  );

  for (const { entity, result } of settled) {
    map.set(entity, result);
  }
  return map;
}

async function runWithConcurrencyLimit<T, R>(
  items: T[],
  maxConcurrent: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const executing = new Set<Promise<void>>();
  const normalizedLimit = Math.max(1, maxConcurrent);

  for (const item of items) {
    const promise = (async () => {
      const result = await task(item);
      results.push(result);
    })();

    executing.add(promise);

    const cleanup = () => executing.delete(promise);
    promise.then(cleanup, cleanup);

    if (executing.size >= normalizedLimit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

function combineResults(
  cluster: ClusterIdentifier,
  testResult: AnyEntityResponse,
  results: Map<EntityType, AnyEntityResponse>,
  testEntity: EntityType,
): ClusterData {
  const combined: Partial<ClusterData> = {
    uuid: cluster.uuid,
    name: cluster.name || cluster.uuid,
    offline: false,
    status: "ok",
  };

  assignEntity(combined, testEntity, testResult.data as EntityDataMap[EntityType]);

  results.forEach((result, entity) => {
    assignEntity(combined, entity, result.data as EntityDataMap[EntityType]);
  });

  const all: EntityType[] = [
    "pods",
    "deployments",
    "replicasets",
    "cronjobs",
    "nodes",
    "namespaces",
    "daemonsets",
    "statefulsets",
    "jobs",
    "poddisruptionbudgets",
    "priorityclasses",
  ];

  for (const e of all) {
    if (!combined[e]) {
      assignEntity(combined, e, { items: [] });
    }
  }

  const errorMessages = [testResult, ...results.values()]
    .filter((r) => r.status === "error")
    .map((r) => r.error);

  if (errorMessages.length > 0) {
    combined.status = "error";
    (combined as ClusterData).errors = errorMessages.join("; ");
  }

  return combined as ClusterData;
}

function createErrorResponse(cluster: ClusterIdentifier, errorMessage: string): ClusterData {
  return {
    uuid: cluster.uuid,
    pods: { items: [] },
    deployments: { items: [] },
    replicasets: { items: [] },
    cronjobs: { items: [] },
    configmaps: { items: [] },
    nodes: { items: [] },
    namespaces: { items: [] },
    daemonsets: { items: [] },
    statefulsets: { items: [] },
    jobs: { items: [] },
    networkpolicies: { items: [] },
    poddisruptionbudgets: { items: [] },
    priorityclasses: { items: [] },
    secrets: { items: [] },
    name: cluster.name || cluster.uuid,
    offline: true,
    status: "error",
    errors: errorMessage,
  };
}

/** Load only specific entities */
export const loadClusterEntities = (
  cluster: ClusterIdentifier,
  entitiesOrConfig: EntityType[] | LoaderConfig,
): Promise<ClusterData> => {
  if (Array.isArray(entitiesOrConfig)) {
    return loadClusterData(cluster, { entities: entitiesOrConfig });
  }

  return loadClusterData(cluster, entitiesOrConfig);
};

/** Load all except specified entities */
export const loadClusterDataExcept = (
  cluster: ClusterIdentifier,
  exclude: EntityType[],
): Promise<ClusterData> => {
  return loadClusterData(cluster, { exclude });
};

/** Load minimal data (only nodes for connection test) */
export const loadClusterMinimal = (cluster: ClusterIdentifier): Promise<ClusterData> => {
  return loadClusterData(cluster, { entities: [] });
};

/** Load with custom test entity and no fail-fast */
export const loadClusterDataResilient = (
  cluster: ClusterIdentifier,
  entities?: EntityType[],
): Promise<ClusterData> => {
  return loadClusterData(cluster, {
    entities,
    failFast: false,
  });
};
