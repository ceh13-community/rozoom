import type { WorkloadType } from "$shared/model/workloads";

type GenericItem = Record<string, unknown>;

type RendererInput = {
  item: GenericItem;
};

type RendererOutput = {
  details: string;
  scoreDelta: number;
};

type Renderer = (input: RendererInput) => RendererOutput;
export type RbacRiskFindingItem = {
  severity: "critical" | "high" | "medium";
  description: string;
};

export type RbacRiskEvaluation = {
  scoreDelta: number;
  findings: RbacRiskFindingItem[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown, fallback = "-"): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}

const defaultRenderer: Renderer = () => ({ details: "-", scoreDelta: 0 });

const RBAC_WORKLOADS = new Set<WorkloadType>([
  "roles",
  "clusterroles",
  "rolebindings",
  "clusterrolebindings",
  "serviceaccounts",
]);

export function evaluateRbacRisk(workloadKey: WorkloadType, item: GenericItem): RbacRiskEvaluation {
  if (!RBAC_WORKLOADS.has(workloadKey)) {
    return { scoreDelta: 0, findings: [] };
  }

  const findings: RbacRiskFindingItem[] = [];
  let score = 0;

  const rules = asArray(asRecord(item).rules);
  for (const rule of rules) {
    const record = asRecord(rule);
    const verbs = asArray(record.verbs).map((entry) => String(entry));
    const resources = asArray(record.resources).map((entry) => String(entry));
    const apiGroups = asArray(record.apiGroups).map((entry) => String(entry));
    const joinedResources = resources.join(",");

    if (verbs.includes("*") || resources.includes("*") || apiGroups.includes("*")) {
      score += 240;
      findings.push({
        severity: "critical",
        description: "Wildcard access in verbs/resources/apiGroups.",
      });
    }
    if (
      resources.includes("secrets") &&
      verbs.some((verb) => ["get", "list", "watch", "*"].includes(verb))
    ) {
      score += 170;
      findings.push({ severity: "high", description: "Secret read access is granted." });
    }
    if (resources.some((resource) => resource === "pods/exec" || resource === "pods/attach")) {
      score += 190;
      findings.push({
        severity: "high",
        description: "Interactive pod access (pods/exec or pods/attach) is granted.",
      });
    }
    if (verbs.includes("impersonate") || joinedResources.includes("impersonate")) {
      score += 210;
      findings.push({ severity: "critical", description: "Impersonation capability is granted." });
    }
  }

  const roleRef = asRecord(item.roleRef);
  const roleRefName = asText(roleRef.name, "").toLowerCase();
  if (
    (workloadKey === "rolebindings" || workloadKey === "clusterrolebindings") &&
    roleRefName === "cluster-admin"
  ) {
    score += 260;
    findings.push({ severity: "critical", description: "Binding to cluster-admin role." });
  }

  const subjects = asArray(asRecord(item).subjects);
  if (
    (workloadKey === "rolebindings" || workloadKey === "clusterrolebindings") &&
    subjects.length === 0
  ) {
    score += 140;
    findings.push({ severity: "medium", description: "No subjects configured for binding." });
  }
  for (const subject of subjects) {
    const entry = asRecord(subject);
    if (String(entry.kind) === "Group" && String(entry.name) === "system:unauthenticated") {
      score += 220;
      findings.push({
        severity: "critical",
        description: "Binding includes system:unauthenticated group.",
      });
    }
  }

  const seen = new Set<string>();
  const dedupedFindings = findings.filter((f) => {
    if (seen.has(f.description)) return false;
    seen.add(f.description);
    return true;
  });

  return {
    scoreDelta: Math.min(score, 1000),
    findings: dedupedFindings,
  };
}

const rendererByWorkload: Partial<Record<WorkloadType, Renderer>> = {
  namespaces: ({ item }) => {
    const status = asRecord(item.status);
    const phase = asText(status.phase, "Active");
    return {
      details: `phase: ${phase}`,
      scoreDelta: phase.toLowerCase() === "active" ? 0 : 120,
    };
  },
  replicationcontrollers: ({ item }) => {
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    const ready = Number(status.readyReplicas ?? 0);
    const desired = Number(spec.replicas ?? 0);
    return {
      details: `ready: ${ready}/${desired} · selector: ${Object.keys(asRecord(spec.selector)).length}`,
      scoreDelta: desired > ready ? Math.min(220, (desired - ready) * 90) : 0,
    };
  },
  configmaps: ({ item }) => {
    const dataMap = asRecord(item.data);
    return {
      details: `keys: ${Object.keys(dataMap).length}`,
      scoreDelta: Object.keys(dataMap).length === 0 ? 80 : 0,
    };
  },
  secrets: ({ item }) => {
    const dataMap = asRecord(item.data);
    return {
      details: `type: ${asText(item.type, "Opaque")} · keys: ${Object.keys(dataMap).length}`,
      scoreDelta: Object.keys(dataMap).length === 0 ? 80 : 0,
    };
  },
  resourcequotas: ({ item }) => {
    const status = asRecord(item.status);
    const hard = Object.keys(asRecord(status.hard)).length;
    const used = Object.keys(asRecord(status.used)).length;
    return {
      details: `hard: ${hard} · used: ${used}`,
      scoreDelta: hard === 0 ? 120 : 0,
    };
  },
  limitranges: ({ item }) => {
    const spec = asRecord(item.spec);
    const limits = asArray(spec.limits).length;
    return {
      details: `limits: ${limits}`,
      scoreDelta: limits === 0 ? 140 : 0,
    };
  },
  horizontalpodautoscalers: ({ item }) => {
    const status = asRecord(item.status);
    const spec = asRecord(item.spec);
    const current = Number(status.currentReplicas ?? 0);
    const desired = Number(status.desiredReplicas ?? current);
    const min = asText(spec.minReplicas);
    const max = Number(spec.maxReplicas ?? desired);
    let score = 0;
    if (desired > current) score += Math.min(280, (desired - current) * 70);
    if (max > 0 && current >= max) score += 100;
    return {
      details: `replicas: ${asText(status.currentReplicas)}/${min}-${asText(spec.maxReplicas)}`,
      scoreDelta: score,
    };
  },
  poddisruptionbudgets: ({ item }) => {
    const status = asRecord(item.status);
    const healthy = Number(status.currentHealthy ?? 0);
    const allowed = Number(status.disruptionsAllowed ?? 0);
    let score = 0;
    if (healthy === 0) score += 260;
    if (allowed === 0) score += 120;
    return {
      details: `healthy: ${asText(status.currentHealthy)} · disruptions: ${asText(status.disruptionsAllowed)}`,
      scoreDelta: score,
    };
  },
  priorityclasses: ({ item }) => ({
    details: `value: ${asText(item.value)} · default: ${asText(item.globalDefault, "false")}`,
    scoreDelta: 0,
  }),
  runtimeclasses: ({ item }) => {
    const spec = asRecord(item.spec);
    return {
      details: `handler: ${asText(spec.handler)}`,
      scoreDelta: 0,
    };
  },
  leases: ({ item }) => {
    const spec = asRecord(item.spec);
    return {
      details: `holder: ${asText(spec.holderIdentity)} · duration: ${asText(spec.leaseDurationSeconds)}s`,
      scoreDelta: spec.holderIdentity ? 0 : 80,
    };
  },
  mutatingwebhookconfigurations: ({ item }) => {
    const webhooks = asArray(item.webhooks).length;
    return {
      details: `webhooks: ${webhooks}`,
      scoreDelta: webhooks === 0 ? 160 : 0,
    };
  },
  validatingwebhookconfigurations: ({ item }) => {
    const webhooks = asArray(item.webhooks).length;
    return {
      details: `webhooks: ${webhooks}`,
      scoreDelta: webhooks === 0 ? 160 : 0,
    };
  },
  serviceaccounts: ({ item }) => {
    const secrets = asArray(item.secrets).length;
    const imagePullSecrets = asArray(asRecord(item).imagePullSecrets).length;
    return {
      details: `secrets: ${secrets} · pull secrets: ${imagePullSecrets}`,
      scoreDelta: 0,
    };
  },
  roles: ({ item }) => {
    const rules = asArray(asRecord(item).rules).length;
    const risk = evaluateRbacRisk("roles", item);
    return {
      details: `rules: ${rules} · risk: ${risk.scoreDelta}`,
      scoreDelta: (rules === 0 ? 120 : 0) + risk.scoreDelta,
    };
  },
  rolebindings: ({ item }) => {
    const subjects = asArray(asRecord(item).subjects).length;
    const roleRef = asRecord(item.roleRef);
    const risk = evaluateRbacRisk("rolebindings", item);
    return {
      details: `subjects: ${subjects} · role: ${asText(roleRef.kind)}/${asText(roleRef.name)} · risk: ${risk.scoreDelta}`,
      scoreDelta: risk.scoreDelta,
    };
  },
  clusterroles: ({ item }) => {
    const rules = asArray(asRecord(item).rules).length;
    const risk = evaluateRbacRisk("clusterroles", item);
    return {
      details: `rules: ${rules} · risk: ${risk.scoreDelta}`,
      scoreDelta: (rules === 0 ? 120 : 0) + risk.scoreDelta,
    };
  },
  clusterrolebindings: ({ item }) => {
    const subjects = asArray(asRecord(item).subjects).length;
    const roleRef = asRecord(item.roleRef);
    const risk = evaluateRbacRisk("clusterrolebindings", item);
    return {
      details: `subjects: ${subjects} · role: ${asText(roleRef.kind)}/${asText(roleRef.name)} · risk: ${risk.scoreDelta}`,
      scoreDelta: risk.scoreDelta,
    };
  },
  customresourcedefinitions: ({ item }) => {
    const spec = asRecord(item.spec);
    const versions = asArray(spec.versions).length;
    return {
      details: `group: ${asText(spec.group)} · versions: ${versions} · scope: ${asText(spec.scope)}`,
      scoreDelta: versions === 0 ? 160 : 0,
    };
  },
  services: ({ item }) => {
    const spec = asRecord(item.spec);
    const ports = asArray(spec.ports).length;
    return {
      details: `type: ${asText(spec.type, "ClusterIP")} · ports: ${ports}`,
      scoreDelta: ports === 0 ? 140 : 0,
    };
  },
  endpoints: ({ item }) => {
    const subsets = asArray(item.subsets);
    const addresses = subsets.reduce<number>((total, subset) => {
      const record = asRecord(subset);
      return total + asArray(record.addresses).length;
    }, 0);
    const notReady = subsets.reduce<number>((total, subset) => {
      const record = asRecord(subset);
      return total + asArray(record.notReadyAddresses).length;
    }, 0);
    const ports = subsets.reduce<number>((total, subset) => {
      const record = asRecord(subset);
      return total + asArray(record.ports).length;
    }, 0);
    return {
      details: `addresses: ${addresses} · not ready: ${notReady} · ports: ${ports}`,
      scoreDelta: addresses === 0 ? 180 : notReady > 0 ? Math.min(120, notReady * 40) : 0,
    };
  },
  endpointslices: ({ item }) => {
    const endpoints = asArray(item.endpoints);
    const ports = asArray(item.ports).length;
    const ready = endpoints.reduce<number>((total, endpoint) => {
      const conditions = asRecord(asRecord(endpoint).conditions);
      return total + (conditions.ready === false ? 0 : 1);
    }, 0);
    const notReady = endpoints.reduce<number>((total, endpoint) => {
      const conditions = asRecord(asRecord(endpoint).conditions);
      return total + (conditions.ready === false ? 1 : 0);
    }, 0);
    return {
      details: `endpoints: ${ready} · not ready: ${notReady} · ports: ${ports}`,
      scoreDelta: ready === 0 ? 180 : notReady > 0 ? Math.min(120, notReady * 40) : 0,
    };
  },
  ingresses: ({ item }) => {
    const spec = asRecord(item.spec);
    const rules = asArray(spec.rules).length;
    return {
      details: `rules: ${rules} · tls: ${asArray(spec.tls).length}`,
      scoreDelta: rules === 0 ? 160 : 0,
    };
  },
  gatewayclasses: ({ item }) => {
    const spec = asRecord(item.spec);
    return {
      details: `controller: ${asText(spec.controllerName)}`,
      scoreDelta: spec.controllerName ? 0 : 120,
    };
  },
  gateways: ({ item }) => {
    const spec = asRecord(item.spec);
    const listeners = asArray(spec.listeners).length;
    return {
      details: `class: ${asText(spec.gatewayClassName)} · listeners: ${listeners}`,
      scoreDelta: listeners === 0 ? 120 : 0,
    };
  },
  httproutes: ({ item }) => {
    const spec = asRecord(item.spec);
    const parents = asArray(spec.parentRefs).length;
    const rules = asArray(spec.rules).length;
    return {
      details: `parent refs: ${parents} · rules: ${rules}`,
      scoreDelta: rules === 0 ? 140 : 0,
    };
  },
  referencegrants: ({ item }) => {
    const spec = asRecord(item.spec);
    return {
      details: `from: ${asArray(spec.from).length} · to: ${asArray(spec.to).length}`,
      scoreDelta: asArray(spec.from).length === 0 || asArray(spec.to).length === 0 ? 90 : 0,
    };
  },
  ingressclasses: ({ item }) => {
    const spec = asRecord(item.spec);
    return {
      details: `controller: ${asText(spec.controller)} · default: ${asText(
        asRecord(asRecord(item.metadata).annotations)[
          "ingressclass.kubernetes.io/is-default-class"
        ],
        "false",
      )}`,
      scoreDelta: spec.controller ? 0 : 120,
    };
  },
  networkpolicies: ({ item }) => {
    const spec = asRecord(item.spec);
    const policyTypes = asArray(spec.policyTypes).length;
    return {
      details: `ingress: ${asArray(spec.ingress).length} · egress: ${asArray(spec.egress).length}`,
      scoreDelta: policyTypes === 0 ? 120 : 0,
    };
  },
  persistentvolumeclaims: ({ item }) => {
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    const phase = asText(status.phase, "");
    return {
      details: `status: ${asText(status.phase)} · storage: ${asText(asRecord(asRecord(spec.resources).requests).storage)}`,
      scoreDelta: phase.toLowerCase() === "bound" ? 0 : 220,
    };
  },
  persistentvolumes: ({ item }) => {
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    const phase = asText(status.phase, "").toLowerCase();
    let score = 0;
    if (phase === "failed") score += 260;
    if (phase === "pending") score += 120;
    return {
      details: `status: ${asText(status.phase)} · capacity: ${asText(asRecord(spec.capacity).storage)}`,
      scoreDelta: score,
    };
  },
  storageclasses: ({ item }) => ({
    details: `provisioner: ${asText(item.provisioner)} · mode: ${asText(item.volumeBindingMode)}`,
    scoreDelta: item.provisioner ? 0 : 180,
  }),
  volumeattributesclasses: ({ item }) => {
    const spec = asRecord(item.spec);
    const parameters = asRecord(spec.parameters);
    return {
      details: `driver: ${asText(spec.driverName)} · parameters: ${Object.keys(parameters).length}`,
      scoreDelta: spec.driverName ? 0 : 180,
    };
  },
  volumesnapshots: ({ item }) => {
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    const readyToUse =
      status.readyToUse === true ? "true" : status.readyToUse === false ? "false" : "-";
    return {
      details: `class: ${asText(spec.volumeSnapshotClassName)} · ready: ${readyToUse} · size: ${asText(status.restoreSize)}`,
      scoreDelta: status.readyToUse === true ? 0 : 180,
    };
  },
  volumesnapshotcontents: ({ item }) => {
    const spec = asRecord(item.spec);
    const status = asRecord(item.status);
    const ref = asRecord(spec.volumeSnapshotRef);
    return {
      details: `snapshot: ${ref.name ? `${asText(ref.namespace, "cluster")}/${asText(ref.name)}` : "-"} · driver: ${asText(spec.driver)} · deletion: ${asText(spec.deletionPolicy)}`,
      scoreDelta: status.readyToUse === true ? 0 : 180,
    };
  },
  volumesnapshotclasses: ({ item }) => {
    const metadata = asRecord(item.metadata);
    const annotations = asRecord(metadata.annotations);
    const defaultClass =
      annotations["snapshot.storage.kubernetes.io/is-default-class"] === true
        ? "true"
        : annotations["snapshot.storage.kubernetes.io/is-default-class"] === false
          ? "false"
          : typeof annotations["snapshot.storage.kubernetes.io/is-default-class"] === "string"
            ? annotations["snapshot.storage.kubernetes.io/is-default-class"]
            : "false";
    return {
      details: `driver: ${asText(item.driver)} · deletion: ${asText(item.deletionPolicy)} · default: ${defaultClass}`,
      scoreDelta: item.driver ? 0 : 180,
    };
  },
  csistoragecapacities: ({ item }) => ({
    details: `storage class: ${asText(item.storageClassName)} · capacity: ${asText(item.maximumVolumeSize, asText(item.capacity))}`,
    scoreDelta: item.storageClassName ? 0 : 120,
  }),
};

export function renderConfigurationSummary(
  workloadKey: WorkloadType,
  item: GenericItem,
): RendererOutput {
  const renderer = rendererByWorkload[workloadKey] ?? defaultRenderer;
  return renderer({ item });
}
