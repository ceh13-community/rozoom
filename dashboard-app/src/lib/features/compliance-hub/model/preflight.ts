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

interface K8sResource {
  metadata?: { name?: string; labels?: Record<string, string> };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function kubectlGet(clusterId: string, args: string[]): Promise<K8sResource[] | null> {
  const res = await kubectlRawArgsFront(args, { clusterId });
  if (res.errors || res.code !== 0) return null;
  try {
    const parsed = JSON.parse(res.output) as { items?: K8sResource[] };
    return parsed.items ?? [];
  } catch {
    return null;
  }
}

async function checkNodeCount(clusterId: string): Promise<PreflightCheck> {
  const items = await kubectlGet(clusterId, ["get", "nodes", "-o", "json"]);
  if (items === null) {
    return {
      id: "nodes",
      title: "Node access",
      status: "fail",
      detail: "Cannot list nodes (RBAC?)",
    };
  }
  return {
    id: "nodes",
    title: "Node access",
    status: items.length > 0 ? "ok" : "fail",
    detail: `${items.length} nodes visible`,
  };
}

async function checkPsaLabels(clusterId: string): Promise<PreflightCheck> {
  const items = await kubectlGet(clusterId, ["get", "namespaces", "-o", "json"]);
  if (items === null) {
    return {
      id: "psa",
      title: "PodSecurity Admission",
      status: "unknown",
      detail: "Cannot list namespaces",
    };
  }
  const restricted: string[] = [];
  for (const ns of items) {
    const labels = asRecord(ns.metadata?.labels);
    const rawEnforce = labels["pod-security.kubernetes.io/enforce"];
    const enforce = typeof rawEnforce === "string" ? rawEnforce : "";
    const name = ns.metadata?.name ?? "";
    if (
      (enforce === "restricted" || enforce === "baseline") &&
      ["kube-system", "kubescape", "kubescape-system"].includes(name)
    ) {
      restricted.push(`${name}=${enforce}`);
    }
  }
  if (restricted.length > 0) {
    return {
      id: "psa",
      title: "PodSecurity Admission",
      status: "fail",
      detail: `Scanner namespaces enforce restricted/baseline: ${restricted.join(", ")}. Scans will fail.`,
    };
  }
  return {
    id: "psa",
    title: "PodSecurity Admission",
    status: "ok",
    detail: "Scanner namespaces are not under restricted/baseline enforcement",
  };
}

async function checkCrds(clusterId: string): Promise<PreflightCheck> {
  const items = await kubectlGet(clusterId, ["get", "crd", "-o", "json"]);
  if (items === null) {
    return { id: "crd", title: "Kubescape CRDs", status: "unknown", detail: "Cannot list CRDs" };
  }
  const kubescapeCrds = items.filter((crd) => {
    const name = crd.metadata?.name ?? "";
    return name.toLowerCase().includes("kubescape") || name.includes("spdx.softwarecomposition");
  });
  if (kubescapeCrds.length > 0) {
    return {
      id: "crd",
      title: "Kubescape CRDs",
      status: "ok",
      detail: `${kubescapeCrds.length} CRDs present`,
    };
  }
  return {
    id: "crd",
    title: "Kubescape CRDs",
    status: "warn",
    detail: "Not installed yet - will be created by Helm",
  };
}

async function checkGatekeeper(clusterId: string): Promise<PreflightCheck> {
  const items = await kubectlGet(clusterId, ["get", "crd", "-o", "json"]);
  if (items === null) {
    return { id: "policy", title: "Policy engines", status: "unknown", detail: "Cannot list CRDs" };
  }
  const hasGatekeeper = items.some((crd) =>
    (crd.metadata?.name ?? "").includes("constraints.gatekeeper.sh"),
  );
  const hasKyverno = items.some((crd) =>
    (crd.metadata?.name ?? "").includes("policies.kyverno.io"),
  );
  const engines: string[] = [];
  if (hasGatekeeper) engines.push("Gatekeeper");
  if (hasKyverno) engines.push("Kyverno");
  if (engines.length > 0) {
    return {
      id: "policy",
      title: "Policy engines",
      status: "warn",
      detail: `${engines.join(" + ")} detected - may need exceptions for privileged scanner pods`,
    };
  }
  return {
    id: "policy",
    title: "Policy engines",
    status: "ok",
    detail: "No Gatekeeper/Kyverno detected",
  };
}

async function checkHostPath(clusterId: string): Promise<PreflightCheck> {
  // Check if PSP or similar blocks hostPath
  // PSP is deprecated; mainly check for Kyverno cluster policies limiting hostPath
  const items = await kubectlGet(clusterId, ["get", "clusterpolicy.kyverno.io", "-o", "json"]);
  if (items === null) {
    return {
      id: "hostpath",
      title: "hostPath support",
      status: "ok",
      detail: "No Kyverno cluster policies to inspect",
    };
  }
  const hostPathRestricted = items.some((p) => {
    const name = (p.metadata?.name ?? "").toLowerCase();
    return name.includes("hostpath") || name.includes("restricted") || name.includes("baseline");
  });
  if (hostPathRestricted) {
    return {
      id: "hostpath",
      title: "hostPath support",
      status: "warn",
      detail:
        "Kyverno policies may restrict hostPath - kube-bench needs /var, /etc, /usr/bin mounts",
    };
  }
  return {
    id: "hostpath",
    title: "hostPath support",
    status: "ok",
    detail: "No blocking policies detected",
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
    checkNodeCount(clusterId),
    checkPsaLabels(clusterId),
    checkCrds(clusterId),
    checkGatekeeper(clusterId),
    checkHostPath(clusterId),
  ]);
  return { overall: combineOverall(checks), checks, ranAt: Date.now() };
}
