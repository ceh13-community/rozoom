import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";

export type PreflightStatus = "ok" | "warn" | "fail" | "unknown";

export interface PreflightCheck {
  id: string;
  title: string;
  status: PreflightStatus;
  detail: string;
}

export interface PreflightReport {
  overall: PreflightStatus;
  checks: PreflightCheck[];
  ranAt: number;
}

interface K8sItem {
  metadata?: { name?: string; namespace?: string };
  status?: {
    phase?: string;
    containerStatuses?: Array<{
      ready?: boolean;
      restartCount?: number;
      state?: Record<string, unknown>;
    }>;
  };
}

async function kubectlGet(clusterId: string, args: string[]): Promise<K8sItem[] | null> {
  const res = await kubectlRawArgsFront(args, { clusterId });
  if (res.errors || res.code !== 0) return null;
  try {
    const parsed = JSON.parse(res.output) as { items?: K8sItem[] };
    return parsed.items ?? [];
  } catch {
    return null;
  }
}

const EXPECTED_CRDS = [
  "vulnerabilityreports.aquasecurity.github.io",
  "configauditreports.aquasecurity.github.io",
  "exposedsecretreports.aquasecurity.github.io",
  "sbomreports.aquasecurity.github.io",
];

async function checkCrds(clusterId: string): Promise<PreflightCheck> {
  const items = await kubectlGet(clusterId, ["get", "crd", "-o", "json"]);
  if (items === null) {
    return {
      id: "crd",
      title: "Trivy CRDs",
      status: "unknown",
      detail: "Cannot list CRDs (RBAC?)",
    };
  }
  const names = items.map((c) => c.metadata?.name ?? "");
  const missing = EXPECTED_CRDS.filter((crd) => !names.includes(crd));
  if (missing.length === 0) {
    return {
      id: "crd",
      title: "Trivy CRDs",
      status: "ok",
      detail: `${EXPECTED_CRDS.length} CRDs present`,
    };
  }
  if (missing.length === EXPECTED_CRDS.length) {
    return {
      id: "crd",
      title: "Trivy CRDs",
      status: "warn",
      detail: "Not installed yet - will be created by Helm",
    };
  }
  return {
    id: "crd",
    title: "Trivy CRDs",
    status: "warn",
    detail: `Partial: ${missing.length} of ${EXPECTED_CRDS.length} missing (${missing.map((m) => m.split(".")[0]).join(", ")})`,
  };
}

async function checkNamespace(clusterId: string): Promise<PreflightCheck> {
  const res = await kubectlRawArgsFront(["get", "namespace", "trivy-system", "-o", "json"], {
    clusterId,
  });
  if (res.code === 0 && !res.errors) {
    return { id: "namespace", title: "trivy-system namespace", status: "ok", detail: "Exists" };
  }
  return {
    id: "namespace",
    title: "trivy-system namespace",
    status: "warn",
    detail: "Not present - will be created by Helm",
  };
}

async function checkOperatorPods(clusterId: string): Promise<PreflightCheck> {
  const items = await kubectlGet(clusterId, ["get", "pods", "-n", "trivy-system", "-o", "json"]);
  if (items === null) {
    return {
      id: "pods",
      title: "Operator pods",
      status: "unknown",
      detail: "Cannot list pods (namespace may not exist yet)",
    };
  }
  if (items.length === 0) {
    return {
      id: "pods",
      title: "Operator pods",
      status: "warn",
      detail: "No pods in trivy-system - install not complete",
    };
  }
  const crashing: string[] = [];
  let healthy = 0;
  for (const pod of items) {
    const name = pod.metadata?.name ?? "";
    const statuses = pod.status?.containerStatuses ?? [];
    const anyCrash = statuses.some((s) => {
      const state = s.state ?? {};
      const waiting = state.waiting as Record<string, unknown> | undefined;
      return (
        waiting?.reason === "CrashLoopBackOff" ||
        waiting?.reason === "ImagePullBackOff" ||
        waiting?.reason === "ErrImagePull" ||
        (s.restartCount ?? 0) > 3
      );
    });
    const allReady = statuses.length > 0 && statuses.every((s) => s.ready === true);
    if (anyCrash) crashing.push(name);
    else if (allReady) healthy++;
  }
  if (crashing.length > 0) {
    return {
      id: "pods",
      title: "Operator pods",
      status: "fail",
      detail: `${crashing.length} pod(s) crashing: ${crashing.slice(0, 3).join(", ")}`,
    };
  }
  return {
    id: "pods",
    title: "Operator pods",
    status: "ok",
    detail: `${healthy}/${items.length} pods ready`,
  };
}

async function checkNodePressure(clusterId: string): Promise<PreflightCheck> {
  const res = await kubectlRawArgsFront(["get", "nodes", "-o", "json"], { clusterId });
  if (res.errors || res.code !== 0) {
    return { id: "disk", title: "Disk pressure", status: "unknown", detail: "Cannot list nodes" };
  }
  try {
    const parsed = JSON.parse(res.output) as {
      items?: Array<{
        metadata?: { name?: string };
        status?: { conditions?: Array<{ type?: string; status?: string }> };
      }>;
    };
    const items = parsed.items ?? [];
    const pressured: string[] = [];
    for (const node of items) {
      const conditions = node.status?.conditions ?? [];
      const diskPressure = conditions.find((c) => c.type === "DiskPressure");
      if (diskPressure?.status === "True") pressured.push(node.metadata?.name ?? "");
    }
    if (pressured.length > 0) {
      return {
        id: "disk",
        title: "Disk pressure",
        status: "fail",
        detail: `Nodes under DiskPressure: ${pressured.join(", ")}. Trivy caches image layers and CVE DB - will crash.`,
      };
    }
    return {
      id: "disk",
      title: "Disk pressure",
      status: "ok",
      detail: `${items.length} nodes, no disk pressure`,
    };
  } catch {
    return { id: "disk", title: "Disk pressure", status: "unknown", detail: "Parse error" };
  }
}

function egressNote(): PreflightCheck {
  return {
    id: "egress",
    title: "Network egress",
    status: "warn",
    detail:
      "Trivy needs egress to ghcr.io (operator + scanner images, CVE DB) and aquasec.github.io. If airgapped, mirror images/DB and override via Helm values.",
  };
}

function combineOverall(checks: PreflightCheck[]): PreflightStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  if (checks.every((c) => c.status === "ok")) return "ok";
  return "unknown";
}

export async function runPreflight(clusterId: string): Promise<PreflightReport> {
  const checks = await Promise.all([
    checkCrds(clusterId),
    checkNamespace(clusterId),
    checkOperatorPods(clusterId),
    checkNodePressure(clusterId),
    Promise.resolve(egressNote()),
  ]);
  return { overall: combineOverall(checks), checks, ranAt: Date.now() };
}
