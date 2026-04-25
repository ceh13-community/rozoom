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

interface NodeSummary {
  name: string;
  kernelVersion: string;
  osImage: string;
  kubeletVersion: string;
  containerRuntime: string;
}

function parseKernelMinor(kernelVersion: string): { major: number; minor: number } | null {
  const match = kernelVersion.match(/^(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function aggregateKernel(nodes: NodeSummary[]): PreflightCheck {
  if (nodes.length === 0) {
    return {
      id: "kernel",
      title: "Node kernel version",
      status: "unknown",
      detail: "No nodes detected",
    };
  }
  let minMajor = 999;
  let minMinor = 999;
  let minNode = "";
  for (const n of nodes) {
    const k = parseKernelMinor(n.kernelVersion);
    if (!k) continue;
    if (k.major < minMajor || (k.major === minMajor && k.minor < minMinor)) {
      minMajor = k.major;
      minMinor = k.minor;
      minNode = n.name;
    }
  }
  if (minMajor === 999) {
    return {
      id: "kernel",
      title: "Node kernel version",
      status: "unknown",
      detail: "Could not parse kernel versions from node status",
    };
  }
  const summary = `oldest: ${minMajor}.${minMinor} on ${minNode} (${nodes.length} nodes)`;
  if (minMajor > 5 || (minMajor === 5 && minMinor >= 8)) {
    return {
      id: "kernel",
      title: "Node kernel version",
      status: "ok",
      detail: `BPF-LSM supported. ${summary}`,
    };
  }
  if (minMajor === 5 && minMinor >= 4) {
    return {
      id: "kernel",
      title: "Node kernel version",
      status: "warn",
      detail: `BPF-LSM needs 5.8+; falls back to AppArmor. ${summary}`,
    };
  }
  return {
    id: "kernel",
    title: "Node kernel version",
    status: "fail",
    detail: `Kernel older than 5.4 is unsupported. ${summary}`,
  };
}

function aggregateOsImage(nodes: NodeSummary[]): PreflightCheck {
  if (nodes.length === 0) {
    return { id: "os", title: "Node OS image", status: "unknown", detail: "No nodes" };
  }
  const families = new Set(nodes.map((n) => n.osImage.toLowerCase()));
  const hasSupported = [...families].some((f) =>
    ["ubuntu", "debian", "amazon", "fedora", "redhat", "centos", "cos", "bottlerocket"].some(
      (name) => f.includes(name),
    ),
  );
  const sample = [...families].slice(0, 3).join(" / ") || "unknown";
  if (hasSupported) {
    return { id: "os", title: "Node OS image", status: "ok", detail: sample };
  }
  return {
    id: "os",
    title: "Node OS image",
    status: "warn",
    detail: `Unrecognized OS: ${sample}. KubeArmor may work but is tested on Ubuntu/Debian/AL2/Flatcar/COS.`,
  };
}

function aggregateRuntime(nodes: NodeSummary[]): PreflightCheck {
  if (nodes.length === 0) {
    return { id: "runtime", title: "Container runtime", status: "unknown", detail: "No nodes" };
  }
  const runtimes = new Set(nodes.map((n) => n.containerRuntime.toLowerCase().split(":")[0] || ""));
  const list = [...runtimes].filter(Boolean).join(", ");
  const hasDocker = [...runtimes].some((r) => r === "docker");
  if (hasDocker && runtimes.size === 1) {
    return {
      id: "runtime",
      title: "Container runtime",
      status: "warn",
      detail: `Docker shim is deprecated in k8s 1.24+. KubeArmor works but prefers containerd/cri-o. Runtimes: ${list}`,
    };
  }
  return { id: "runtime", title: "Container runtime", status: "ok", detail: list };
}

async function fetchNodes(clusterId: string): Promise<NodeSummary[]> {
  const res = await kubectlRawArgsFront(["get", "nodes", "-o", "json"], { clusterId });
  if (res.errors || res.code !== 0) return [];
  try {
    const parsed = JSON.parse(res.output) as {
      items?: Array<{
        metadata?: { name?: string };
        status?: {
          nodeInfo?: {
            kernelVersion?: string;
            osImage?: string;
            kubeletVersion?: string;
            containerRuntimeVersion?: string;
          };
        };
      }>;
    };
    return (parsed.items ?? []).map((n) => ({
      name: n.metadata?.name ?? "",
      kernelVersion: n.status?.nodeInfo?.kernelVersion ?? "",
      osImage: n.status?.nodeInfo?.osImage ?? "",
      kubeletVersion: n.status?.nodeInfo?.kubeletVersion ?? "",
      containerRuntime: n.status?.nodeInfo?.containerRuntimeVersion ?? "",
    }));
  } catch {
    return [];
  }
}

async function checkCrds(clusterId: string): Promise<PreflightCheck> {
  const res = await kubectlRawArgsFront(["get", "crd", "-o", "json"], { clusterId });
  if (res.errors || res.code !== 0) {
    return { id: "crd", title: "KubeArmor CRDs", status: "unknown", detail: "Cannot list CRDs" };
  }
  try {
    const parsed = JSON.parse(res.output) as { items?: Array<{ metadata?: { name?: string } }> };
    const names = (parsed.items ?? []).map((i) => i.metadata?.name ?? "");
    const armor = names.filter((n) => n.toLowerCase().includes("kubearmor"));
    if (armor.length > 0) {
      return {
        id: "crd",
        title: "KubeArmor CRDs",
        status: "ok",
        detail: `${armor.length} CRDs present`,
      };
    }
    return {
      id: "crd",
      title: "KubeArmor CRDs",
      status: "warn",
      detail: "Not installed yet - will be created by Helm",
    };
  } catch {
    return { id: "crd", title: "KubeArmor CRDs", status: "unknown", detail: "Parse error" };
  }
}

async function checkNamespace(clusterId: string): Promise<PreflightCheck> {
  const res = await kubectlRawArgsFront(["get", "namespace", "kubearmor", "-o", "json"], {
    clusterId,
  });
  if (res.code === 0 && !res.errors) {
    return {
      id: "namespace",
      title: "kubearmor namespace",
      status: "ok",
      detail: "Exists",
    };
  }
  return {
    id: "namespace",
    title: "kubearmor namespace",
    status: "warn",
    detail: "Not present - will be created by Helm",
  };
}

function combineOverall(checks: PreflightCheck[]): PreflightStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  if (checks.every((c) => c.status === "ok")) return "ok";
  return "unknown";
}

export async function runPreflight(clusterId: string): Promise<PreflightReport> {
  const nodes = await fetchNodes(clusterId);
  const checks: PreflightCheck[] = [
    aggregateKernel(nodes),
    aggregateOsImage(nodes),
    aggregateRuntime(nodes),
    await checkCrds(clusterId),
    await checkNamespace(clusterId),
  ];
  return { overall: combineOverall(checks), checks, ranAt: Date.now() };
}
