import type { ProblemResource } from "./triage";
import type { TriageManifestEntry, TriageScorerId } from "./triage-manifest";

export type TriageScoreResult = {
  problemScore: number;
  status: string;
  reason: string | null;
};

export type TriageScorerContext = {
  entry: TriageManifestEntry;
  items: Record<string, unknown>[];
};

export type TriageScorer = (
  item: Record<string, unknown>,
  context: TriageScorerContext,
) => TriageScoreResult;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => asRecord(item)) : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => asString(item)) : [];
}

function asNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function joinReasons(reasons: Array<string | null | undefined>) {
  return reasons.filter(Boolean).join(" · ") || null;
}

function boolAnnotation(metadata: Record<string, unknown>, key: string) {
  const annotations = asRecord(metadata.annotations);
  return asString(annotations[key]).toLowerCase() === "true";
}

function countByPredicate(
  items: Record<string, unknown>[],
  predicate: (item: Record<string, unknown>) => boolean,
) {
  return items.reduce((acc, item) => acc + (predicate(item) ? 1 : 0), 0);
}

const scoreController: TriageScorer = (item) => {
  const metadata = asRecord(item.metadata);
  const spec = asRecord(item.spec);
  const status = asRecord(item.status);
  const desired = Math.max(asNumber(spec.replicas), 0);
  const available = Math.max(
    asNumber(status.availableReplicas || status.readyReplicas || status.updatedReplicas),
    0,
  );
  const unavailable = Math.max(
    asNumber(status.unavailableReplicas) || Math.max(desired - available, 0),
    0,
  );
  const progressing = asArray(status.conditions).find(
    (condition) =>
      asString(condition.type).toLowerCase() === "progressing" &&
      asString(condition.status).toLowerCase() === "false",
  );

  return {
    problemScore:
      unavailable * 120 +
      (desired > 0 && available === 0 ? 180 : 0) +
      (metadata.deletionTimestamp ? 260 : 0) +
      (progressing ? 140 : 0),
    status: `${available}/${desired} available`,
    reason: joinReasons([
      unavailable > 0 ? `${unavailable} unavailable replicas` : null,
      progressing ? asString(progressing.reason, "progressing check failed") : null,
      metadata.deletionTimestamp ? "deleting" : null,
    ]),
  };
};

export const triageScorers: Record<TriageScorerId, TriageScorer> = {
  namespaces: (item) => {
    const metadata = asRecord(item.metadata);
    const status = asRecord(item.status);
    const phase = asString(status.phase, "Unknown");
    return {
      problemScore:
        (phase.toLowerCase() !== "active" ? 240 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: phase,
      reason: joinReasons([
        phase.toLowerCase() !== "active" ? `phase ${phase}` : null,
        metadata.deletionTimestamp ? "terminating" : null,
      ]),
    };
  },
  nodes: (item) => {
    const status = asRecord(item.status);
    const conditions = asArray(status.conditions);
    const ready = conditions.find((condition) => asString(condition.type) === "Ready");
    const memoryPressure = conditions.find(
      (condition) =>
        asString(condition.type) === "MemoryPressure" &&
        asString(condition.status).toLowerCase() === "true",
    );
    const diskPressure = conditions.find(
      (condition) =>
        asString(condition.type) === "DiskPressure" &&
        asString(condition.status).toLowerCase() === "true",
    );
    const pidPressure = conditions.find(
      (condition) =>
        asString(condition.type) === "PIDPressure" &&
        asString(condition.status).toLowerCase() === "true",
    );
    const readyStatus = asString(ready?.status, "Unknown");
    return {
      problemScore:
        (readyStatus === "True" ? 0 : readyStatus === "False" ? 300 : 240) +
        (memoryPressure ? 80 : 0) +
        (diskPressure ? 80 : 0) +
        (pidPressure ? 60 : 0),
      status: readyStatus === "True" ? "Ready" : readyStatus === "False" ? "NotReady" : "Unknown",
      reason: joinReasons([
        readyStatus === "True" ? null : `Ready=${readyStatus}`,
        memoryPressure ? "memory pressure" : null,
        diskPressure ? "disk pressure" : null,
        pidPressure ? "PID pressure" : null,
      ]),
    };
  },
  pods: (item) => {
    const metadata = asRecord(item.metadata);
    const status = asRecord(item.status);
    const phase = asString(status.phase, "Unknown");
    const containerStatuses = asArray(status.containerStatuses);
    const restarts = containerStatuses.reduce((acc, next) => acc + asNumber(next.restartCount), 0);
    const waiting = containerStatuses.find((next) => asRecord(next.state).waiting);
    return {
      problemScore:
        (phase.toLowerCase() === "running" || phase.toLowerCase() === "succeeded" ? 0 : 220) +
        restarts * 35 +
        (waiting ? 90 : 0) +
        (metadata.deletionTimestamp ? 260 : 0),
      status: phase,
      reason: joinReasons([
        phase.toLowerCase() === "running" || phase.toLowerCase() === "succeeded"
          ? null
          : `phase ${phase}`,
        restarts > 0 ? `${restarts} restarts` : null,
        waiting ? asString(asRecord(asRecord(waiting.state).waiting).reason, "waiting") : null,
      ]),
    };
  },
  controller: scoreController,
  jobs: (item) => {
    const metadata = asRecord(item.metadata);
    const status = asRecord(item.status);
    const failed = asNumber(status.failed);
    const active = asNumber(status.active);
    const succeeded = asNumber(status.succeeded);
    return {
      problemScore: failed * 220 + (active > 0 ? 40 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status:
        failed > 0
          ? `Failed (${failed})`
          : active > 0
            ? `Active (${active})`
            : succeeded > 0
              ? `Succeeded (${succeeded})`
              : "Idle",
      reason: joinReasons([
        failed > 0 ? `${failed} failed pods` : null,
        active > 0 ? `${active} active pods` : null,
      ]),
    };
  },
  cronjobs: (item) => {
    const status = asRecord(item.status);
    const spec = asRecord(item.spec);
    const active = asArray(status.active).length;
    const suspended = Boolean(spec.suspend);
    const lastSchedule = asString(status.lastScheduleTime);
    return {
      problemScore: (active > 0 ? 40 : 0) + (lastSchedule ? 0 : 20),
      status: suspended ? "Suspended" : active > 0 ? `Active (${active})` : "Scheduled",
      reason: joinReasons([
        suspended ? "suspended" : null,
        active > 0 ? `${active} active runs` : null,
        lastSchedule ? null : "no last schedule recorded",
      ]),
    };
  },
  configmaps: (item) => {
    const metadata = asRecord(item.metadata);
    const data = asRecord(item.data);
    const binaryData = asRecord(item.binaryData);
    const keys = Object.keys(data).length + Object.keys(binaryData).length;
    return {
      problemScore: (keys === 0 ? 60 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: `${keys} keys`,
      reason: joinReasons([
        keys === 0 ? "no data keys" : null,
        metadata.deletionTimestamp ? "deleting" : null,
      ]),
    };
  },
  secrets: (item) => {
    const metadata = asRecord(item.metadata);
    const data = asRecord(item.data);
    const stringData = asRecord(item.stringData);
    const type = asString(item.type);
    const keys = Object.keys(data).length + Object.keys(stringData).length;
    return {
      problemScore:
        (keys === 0 && type !== "kubernetes.io/service-account-token" ? 80 : 0) +
        (type.length === 0 ? 30 : 0) +
        (metadata.deletionTimestamp ? 260 : 0),
      status: type || "Opaque",
      reason: joinReasons([
        keys === 0 && type !== "kubernetes.io/service-account-token" ? "no secret data" : null,
        type.length === 0 ? "secret type missing" : null,
      ]),
    };
  },
  resourcequotas: (item) => {
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    const hard =
      Object.keys(asRecord(status.hard)).length || Object.keys(asRecord(spec.hard)).length;
    return {
      problemScore: (hard === 0 ? 100 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: `${hard} hard limits`,
      reason: joinReasons([hard === 0 ? "quota has no hard limits" : null]),
    };
  },
  limitranges: (item) => {
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const limits = asArray(spec.limits).length;
    return {
      problemScore: (limits === 0 ? 100 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: `${limits} limits`,
      reason: joinReasons([limits === 0 ? "no limit rules defined" : null]),
    };
  },
  persistentvolumeclaims: (item) => {
    const status = asRecord(item.status);
    const phase = asString(status.phase, "Unknown");
    return {
      problemScore: phase.toLowerCase() === "bound" ? 0 : 220,
      status: phase,
      reason: phase.toLowerCase() === "bound" ? null : `phase ${phase}`,
    };
  },
  persistentvolumes: (item) => {
    const status = asRecord(item.status);
    const phase = asString(status.phase, "Unknown");
    return {
      problemScore: phase.toLowerCase() === "bound" ? 0 : 220,
      status: phase,
      reason: phase.toLowerCase() === "bound" ? null : `phase ${phase}`,
    };
  },
  priorityclasses: (item, context) => {
    const metadata = asRecord(item.metadata);
    const globalDefault = Boolean(item.globalDefault);
    const duplicates = globalDefault
      ? countByPredicate(context.items, (candidate) => Boolean(candidate.globalDefault))
      : 0;
    const value = asNumber(item.value);
    return {
      problemScore:
        (globalDefault && duplicates > 1 ? 220 : 0) +
        (value === 0 ? 30 : 0) +
        (metadata.deletionTimestamp ? 260 : 0),
      status: globalDefault ? "Global default" : String(value),
      reason: joinReasons([
        globalDefault && duplicates > 1 ? `${duplicates} global defaults defined` : null,
        value === 0 ? "priority value is zero" : null,
      ]),
    };
  },
  runtimeclasses: (item) => {
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const handler = asString(spec.handler);
    return {
      problemScore: (handler.length === 0 ? 180 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: handler || "Missing handler",
      reason: handler.length === 0 ? "runtime class handler missing" : null,
    };
  },
  leases: (item) => {
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const holder = asString(spec.holderIdentity);
    return {
      problemScore: (holder.length === 0 ? 40 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: holder || "Unheld",
      reason: holder.length === 0 ? "lease holder identity missing" : null,
    };
  },
  webhookconfigurations: (item) => {
    const metadata = asRecord(item.metadata);
    const webhooks = asArray((item as { webhooks?: unknown }).webhooks).length;
    return {
      problemScore: (webhooks === 0 ? 180 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: `${webhooks} webhooks`,
      reason: webhooks === 0 ? "no webhooks configured" : null,
    };
  },
  serviceaccounts: (item) => {
    const metadata = asRecord(item.metadata);
    return {
      problemScore: metadata.deletionTimestamp ? 260 : 0,
      status: "Active",
      reason: metadata.deletionTimestamp ? "deleting" : null,
    };
  },
  roles: (item) => {
    const metadata = asRecord(item.metadata);
    const rules = asArray((item as { rules?: unknown }).rules);
    const wildcard = rules.find((rule) => {
      const resources = asStringArray(rule.resources);
      const verbs = asStringArray(rule.verbs);
      const apiGroups = asStringArray(rule.apiGroups);
      return resources.includes("*") || verbs.includes("*") || apiGroups.includes("*");
    });
    return {
      problemScore: (wildcard ? 180 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: `${rules.length} rules`,
      reason: joinReasons([
        wildcard ? "wildcard RBAC rule" : null,
        metadata.deletionTimestamp ? "deleting" : null,
      ]),
    };
  },
  bindings: (item) => {
    const metadata = asRecord(item.metadata);
    const roleRef = asRecord((item as { roleRef?: unknown }).roleRef);
    const subjects = asArray((item as { subjects?: unknown }).subjects);
    const riskySubject = subjects.find((subject) => {
      const kind = asString(subject.kind);
      const name = asString(subject.name);
      return (
        (kind === "Group" &&
          (name === "system:unauthenticated" || name === "system:authenticated")) ||
        name === "system:anonymous"
      );
    });
    const clusterAdmin = asString(roleRef.name) === "cluster-admin";
    return {
      problemScore:
        (clusterAdmin ? 220 : 0) +
        (riskySubject ? 180 : 0) +
        (subjects.length === 0 ? 80 : 0) +
        (metadata.deletionTimestamp ? 260 : 0),
      status: `${subjects.length} subjects`,
      reason: joinReasons([
        clusterAdmin ? "binds cluster-admin" : null,
        riskySubject ? `risky subject ${asString(riskySubject.name, "unknown")}` : null,
        subjects.length === 0 ? "binding has no subjects" : null,
      ]),
    };
  },
  customresourcedefinitions: (item) => {
    const metadata = asRecord(item.metadata);
    const status = asRecord(item.status);
    const conditions = asArray(status.conditions);
    const established = conditions.find((condition) => asString(condition.type) === "Established");
    const namesAccepted = conditions.find(
      (condition) => asString(condition.type) === "NamesAccepted",
    );
    const versions = asArray(asRecord(item.spec).versions).length;
    return {
      problemScore:
        (asString(established?.status, "True") !== "True" ? 220 : 0) +
        (asString(namesAccepted?.status, "True") !== "True" ? 160 : 0) +
        (versions === 0 ? 120 : 0) +
        (metadata.deletionTimestamp ? 260 : 0),
      status: `${versions} versions`,
      reason: joinReasons([
        asString(established?.status, "True") !== "True" ? "not established" : null,
        asString(namesAccepted?.status, "True") !== "True" ? "name conflict" : null,
        versions === 0 ? "no CRD versions defined" : null,
      ]),
    };
  },
  services: (item) => {
    const spec = asRecord(item.spec);
    const ports = asArray(spec.ports);
    const type = asString(spec.type, "ClusterIP");
    return {
      problemScore: ports.length > 0 ? 0 : 140,
      status: `${type}${ports.length > 0 ? ` · ${ports.length} ports` : ""}`,
      reason: ports.length > 0 ? null : "no service ports defined",
    };
  },
  endpoints: (item) => {
    const subsets = asArray((item as { subsets?: unknown }).subsets);
    const total = subsets.reduce(
      (acc, subset) =>
        acc + asArray(subset.addresses).length + asArray(subset.notReadyAddresses).length,
      0,
    );
    return {
      problemScore: total > 0 ? 0 : 180,
      status: `${total} endpoints`,
      reason: total > 0 ? null : "no endpoints available",
    };
  },
  endpointslices: (item) => {
    const total = asArray((item as { endpoints?: unknown }).endpoints).length;
    return {
      problemScore: total > 0 ? 0 : 180,
      status: `${total} endpoints`,
      reason: total > 0 ? null : "no endpoints available",
    };
  },
  ingresses: (item) => {
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    const rules = asArray(spec.rules).length;
    const loadBalancerIngress = asArray(asRecord(status.loadBalancer).ingress).length;
    return {
      problemScore: (rules > 0 ? 0 : 160) + (loadBalancerIngress > 0 ? 0 : 20),
      status: `${rules} rules`,
      reason: joinReasons([
        rules > 0 ? null : "no ingress rules",
        loadBalancerIngress > 0 ? null : "no load balancer address",
      ]),
    };
  },
  ingressclasses: (item, context) => {
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const controller = asString(spec.controller);
    const isDefault = boolAnnotation(metadata, "ingressclass.kubernetes.io/is-default-class");
    const duplicates = isDefault
      ? countByPredicate(context.items, (candidate) =>
          boolAnnotation(
            asRecord(candidate.metadata),
            "ingressclass.kubernetes.io/is-default-class",
          ),
        )
      : 0;
    return {
      problemScore:
        (controller.length === 0 ? 180 : 0) +
        (isDefault && duplicates > 1 ? 180 : 0) +
        (metadata.deletionTimestamp ? 260 : 0),
      status: controller || "Missing controller",
      reason: joinReasons([
        controller.length === 0 ? "ingress class controller missing" : null,
        isDefault && duplicates > 1 ? `${duplicates} default ingress classes` : null,
      ]),
    };
  },
  gatewayclasses: (item) => {
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    const conditions = asArray(status.conditions);
    const accepted = conditions.find((condition) => asString(condition.type) === "Accepted");
    const controllerName = asString(spec.controllerName);
    return {
      problemScore:
        (controllerName.length === 0 ? 180 : 0) +
        (accepted && asString(accepted.status) !== "True" ? 220 : 0) +
        (metadata.deletionTimestamp ? 260 : 0),
      status: controllerName || "Missing controller",
      reason: joinReasons([
        controllerName.length === 0 ? "gateway class controller missing" : null,
        accepted && asString(accepted.status) !== "True"
          ? asString(accepted.reason, "gateway class not accepted")
          : null,
      ]),
    };
  },
  gateways: (item) => {
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    const listeners = asArray(spec.listeners).length;
    const conditions = asArray(status.conditions);
    const accepted = conditions.find((condition) => asString(condition.type) === "Accepted");
    const programmed = conditions.find((condition) => asString(condition.type) === "Programmed");
    return {
      problemScore:
        (listeners === 0 ? 160 : 0) +
        (accepted && asString(accepted.status) !== "True" ? 220 : 0) +
        (programmed && asString(programmed.status) !== "True" ? 180 : 0) +
        (metadata.deletionTimestamp ? 260 : 0),
      status: `${listeners} listeners`,
      reason: joinReasons([
        listeners === 0 ? "no listeners configured" : null,
        accepted && asString(accepted.status) !== "True"
          ? asString(accepted.reason, "gateway not accepted")
          : null,
        programmed && asString(programmed.status) !== "True"
          ? asString(programmed.reason, "gateway not programmed")
          : null,
      ]),
    };
  },
  httproutes: (item) => {
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    const parents = asArray(spec.parentRefs).length;
    const conditions = asArray(asRecord(asArray(status.parents)[0]).conditions);
    const accepted = conditions.find((condition) => asString(condition.type) === "Accepted");
    const resolvedRefs = conditions.find(
      (condition) => asString(condition.type) === "ResolvedRefs",
    );
    return {
      problemScore:
        (parents === 0 ? 160 : 0) +
        (accepted && asString(accepted.status) !== "True" ? 220 : 0) +
        (resolvedRefs && asString(resolvedRefs.status) !== "True" ? 180 : 0) +
        (metadata.deletionTimestamp ? 260 : 0),
      status: `${parents} parent refs`,
      reason: joinReasons([
        parents === 0 ? "no parent refs" : null,
        accepted && asString(accepted.status) !== "True"
          ? asString(accepted.reason, "route not accepted")
          : null,
        resolvedRefs && asString(resolvedRefs.status) !== "True"
          ? asString(resolvedRefs.reason, "references unresolved")
          : null,
      ]),
    };
  },
  referencegrants: (item) => {
    const metadata = asRecord(item.metadata);
    const spec = asRecord(item.spec);
    const from = asArray(spec.from).length;
    const to = asArray(spec.to).length;
    return {
      problemScore:
        (from === 0 ? 120 : 0) + (to === 0 ? 120 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: `${from} from / ${to} to`,
      reason: joinReasons([
        from === 0 ? "reference grant has no from rules" : null,
        to === 0 ? "reference grant has no to rules" : null,
      ]),
    };
  },
  networkpolicies: (item) => {
    const spec = asRecord(item.spec);
    const policyTypes = asStringArray(spec.policyTypes);
    return {
      problemScore: policyTypes.length > 0 ? 0 : 120,
      status: policyTypes.length > 0 ? policyTypes.join(", ") : "Unspecified",
      reason: policyTypes.length > 0 ? null : "policyTypes missing",
    };
  },
  horizontalpodautoscalers: (item) => {
    const status = asRecord(item.status);
    const conditions = asArray(status.conditions);
    const failing = conditions.find(
      (condition) =>
        asString(condition.status).toLowerCase() === "false" ||
        asString(condition.status).toLowerCase() === "unknown",
    );
    const current = asNumber(status.currentReplicas);
    const desired = asNumber(status.desiredReplicas);
    return {
      problemScore: (failing ? 180 : 0) + (desired > 0 && current === 0 ? 120 : 0),
      status: desired > 0 ? `${current}/${desired} replicas` : "Idle",
      reason: joinReasons([
        failing
          ? `${asString(failing.type, "condition")}=${asString(failing.status, "Unknown")}`
          : null,
        desired > 0 && current === 0 ? "desired replicas unavailable" : null,
      ]),
    };
  },
  poddisruptionbudgets: (item) => {
    const status = asRecord(item.status);
    const disruptionsAllowed = asNumber(status.disruptionsAllowed);
    const currentHealthy = asNumber(status.currentHealthy);
    const desiredHealthy = asNumber(status.desiredHealthy);
    return {
      problemScore:
        (disruptionsAllowed === 0 ? 80 : 0) + (currentHealthy < desiredHealthy ? 180 : 0),
      status: `${disruptionsAllowed} disruptions allowed`,
      reason: joinReasons([
        disruptionsAllowed === 0 ? "no disruptions allowed" : null,
        currentHealthy < desiredHealthy ? `${currentHealthy}/${desiredHealthy} healthy` : null,
      ]),
    };
  },
  storageclasses: (item, context) => {
    const metadata = asRecord(item.metadata);
    const provisioner = asString(item.provisioner);
    const isDefault = boolAnnotation(metadata, "storageclass.kubernetes.io/is-default-class");
    const duplicates = isDefault
      ? countByPredicate(context.items, (candidate) =>
          boolAnnotation(
            asRecord(candidate.metadata),
            "storageclass.kubernetes.io/is-default-class",
          ),
        )
      : 0;
    return {
      problemScore:
        (provisioner.length === 0 ? 200 : 0) +
        (isDefault && duplicates > 1 ? 180 : 0) +
        (metadata.deletionTimestamp ? 260 : 0),
      status: provisioner || "Missing provisioner",
      reason: joinReasons([
        provisioner.length === 0 ? "storage class provisioner missing" : null,
        isDefault && duplicates > 1 ? `${duplicates} default storage classes` : null,
      ]),
    };
  },
  volumeattributesclasses: (item) => {
    const metadata = asRecord(item.metadata);
    const driverName = asString(asRecord(item.spec).driverName);
    return {
      problemScore: (driverName.length === 0 ? 180 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: driverName || "Missing driver",
      reason: driverName.length === 0 ? "volume attributes class driver missing" : null,
    };
  },
  volumesnapshots: (item) => {
    const metadata = asRecord(item.metadata);
    const status = asRecord(item.status);
    const ready = Boolean(status.readyToUse);
    const error = asString(asRecord(status.error).message);
    return {
      problemScore: (ready ? 0 : 220) + (metadata.deletionTimestamp ? 260 : 0),
      status: ready ? "Ready" : "Not ready",
      reason: ready ? null : error || "snapshot not ready",
    };
  },
  volumesnapshotcontents: (item) => {
    const metadata = asRecord(item.metadata);
    const status = asRecord(item.status);
    const ready = Boolean(status.readyToUse);
    const error = asString(asRecord(status.error).message);
    return {
      problemScore: (ready ? 0 : 220) + (error ? 80 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: ready ? "Ready" : "Not ready",
      reason: joinReasons([error || null, !ready && !error ? "snapshot content not ready" : null]),
    };
  },
  volumesnapshotclasses: (item, context) => {
    const metadata = asRecord(item.metadata);
    const driver = asString(item.driver);
    const isDefault = boolAnnotation(metadata, "snapshot.storage.kubernetes.io/is-default-class");
    const duplicates = isDefault
      ? countByPredicate(context.items, (candidate) =>
          boolAnnotation(
            asRecord(candidate.metadata),
            "snapshot.storage.kubernetes.io/is-default-class",
          ),
        )
      : 0;
    return {
      problemScore:
        (driver.length === 0 ? 180 : 0) +
        (isDefault && duplicates > 1 ? 180 : 0) +
        (metadata.deletionTimestamp ? 260 : 0),
      status: driver || "Missing driver",
      reason: joinReasons([
        driver.length === 0 ? "snapshot class driver missing" : null,
        isDefault && duplicates > 1 ? `${duplicates} default snapshot classes` : null,
      ]),
    };
  },
  csistoragecapacities: (item) => {
    const metadata = asRecord(item.metadata);
    const capacity = asString(item.capacity);
    return {
      problemScore: (capacity.length === 0 ? 140 : 0) + (metadata.deletionTimestamp ? 260 : 0),
      status: capacity || "Unknown capacity",
      reason: capacity.length === 0 ? "CSI storage capacity missing" : null,
    };
  },
};

export function evaluateProblemResource(
  entry: TriageManifestEntry,
  item: Record<string, unknown>,
  items: Record<string, unknown>[] = [],
): ProblemResource {
  const metadata = asRecord(item.metadata);
  const namespace = asString(metadata.namespace, "cluster");
  const name = asString(metadata.name, "unknown");
  const scorer = triageScorers[entry.scorerId];
  const result = scorer(item, { entry, items });

  return {
    id: `${entry.key}:${namespace}/${name}`,
    name,
    namespace,
    workload: entry.key,
    workloadKey: entry.key,
    workloadLabel: entry.title,
    problemScore: result.problemScore,
    status: result.status,
    reason: result.reason ?? undefined,
  };
}
