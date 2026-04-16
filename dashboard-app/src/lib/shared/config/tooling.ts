export const DEBUG_SHELL_IMAGE_CANDIDATES = [
  "dtzar/helm-kubectl:3.14.4",
  "nicolaka/netshoot:latest",
] as const;

export const METRICS_SERVER_INSTALL_PROFILES = {
  standard: {
    id: "standard",
    args: [
      "--kubelet-preferred-address-types=InternalDNS,Hostname,InternalIP,ExternalDNS,ExternalIP",
      "--kubelet-use-node-status-port",
    ],
  },
  local: {
    id: "local",
    args: [
      "--kubelet-preferred-address-types=Hostname,InternalDNS,InternalIP,ExternalDNS,ExternalIP",
      "--kubelet-use-node-status-port",
      "--kubelet-insecure-tls",
    ],
  },
} as const;

export type MetricsServerInstallProfileId = keyof typeof METRICS_SERVER_INSTALL_PROFILES;

export const LOCAL_CLUSTER_NODE_NAME_PATTERNS = [
  /^minikube$/i,
  /^kind-/i,
  /^kind$/i,
  /^k3d-/i,
  /^docker-desktop$/i,
  /^orbstack$/i,
] as const;

export const MANAGED_CHARTS = {
  metricsServer: {
    repo: "https://kubernetes-sigs.github.io/metrics-server/",
    chart: "metrics-server/metrics-server",
    defaultProfile: "auto",
  },
} as const;

// ── Tool Registry ────────────────────────────────────────────────
// Single source of truth for every CLI that ROZOOM knows about.
// download-binaries.js downloads them; cli-detection.ts probes them.

import type { ClusterProvider } from "$shared/lib/provider-detection";

export type ToolStatus = "bundled" | "planned";

export type ToolEntry = {
  tool: string;
  provider: ClusterProvider | null;
  status: ToolStatus;
  /** Args to check the tool is alive (bundled & OS). */
  probeArgs: string[];
  /** Args to get version from OS-installed tool (may differ from bundled). */
  osVersionArgs?: string[];
};

// ── Build-time tool filter ───────────────────────────────────────
// Set VITE_ROZOOM_TOOLS=kubectl,helm,aws to bundle only selected tools.
// Unset or empty = all tools enabled (default).
const ENABLED_TOOLS_CSV = (import.meta.env.VITE_ROZOOM_TOOLS as string | undefined) ?? "";
const ENABLED_TOOLS_SET: Set<string> | null = ENABLED_TOOLS_CSV.trim()
  ? new Set(
      ENABLED_TOOLS_CSV.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;

export function isToolEnabled(tool: string): boolean {
  return !ENABLED_TOOLS_SET || ENABLED_TOOLS_SET.has(tool);
}

const FULL_TOOL_REGISTRY: readonly ToolEntry[] = [
  // Core K8s
  { tool: "kubectl", provider: null, status: "bundled", probeArgs: ["version", "--client"] },
  { tool: "helm", provider: null, status: "bundled", probeArgs: ["version", "--short"] },
  { tool: "kustomize", provider: null, status: "bundled", probeArgs: ["version"] },
  // Validation & quality
  { tool: "kubeconform", provider: null, status: "bundled", probeArgs: ["-v"] },
  { tool: "pluto", provider: null, status: "bundled", probeArgs: ["version"] },
  // Debug & operations
  { tool: "stern", provider: null, status: "bundled", probeArgs: ["--version"] },
  { tool: "velero", provider: null, status: "bundled", probeArgs: ["version", "--client-only"] },
  { tool: "yq", provider: null, status: "bundled", probeArgs: ["--version"] },
  // Network & debug
  { tool: "curl", provider: null, status: "bundled", probeArgs: ["--version"] },
  { tool: "doggo", provider: null, status: "bundled", probeArgs: ["--version"] },
  { tool: "grpcurl", provider: null, status: "bundled", probeArgs: ["--version"] },
  { tool: "websocat", provider: null, status: "bundled", probeArgs: ["--version"] },
  { tool: "tcping", provider: null, status: "bundled", probeArgs: ["--version"] },
  // Security
  { tool: "trivy", provider: null, status: "bundled", probeArgs: ["version"] },
  // Cloud providers
  { tool: "aws", provider: "AWS EKS", status: "bundled", probeArgs: ["--version"] },
  { tool: "gcloud", provider: "GKE", status: "planned", probeArgs: ["version"] },
  { tool: "doctl", provider: "DigitalOcean", status: "bundled", probeArgs: ["version"] },
  { tool: "hcloud", provider: "Hetzner", status: "bundled", probeArgs: ["version"] },
  { tool: "oc", provider: "OpenShift", status: "bundled", probeArgs: ["version", "--client"] },
  { tool: "az", provider: "AKS", status: "bundled", probeArgs: ["version"] },
] as const;

/** Full registry (unfiltered). Use TOOL_REGISTRY for runtime. */
export { FULL_TOOL_REGISTRY };

/** Filtered by VITE_ROZOOM_TOOLS - only enabled tools appear everywhere. */
export const TOOL_REGISTRY: readonly ToolEntry[] = FULL_TOOL_REGISTRY.filter((t) =>
  isToolEnabled(t.tool),
);

export const BUNDLED_TOOLS = TOOL_REGISTRY.filter((t) => t.status === "bundled");
export const PLANNED_TOOLS = TOOL_REGISTRY.filter((t) => t.status === "planned");

// ── Cloud config paths (relative to $HOME) ───────────────────────

export type CloudConfigProbe = {
  provider: ClusterProvider;
  label: string;
  relPath: string;
};

export const CLOUD_CONFIG_PROBES: readonly CloudConfigProbe[] = [
  { provider: "AWS EKS", label: "AWS credentials", relPath: ".aws/credentials" },
  { provider: "AWS EKS", label: "AWS config", relPath: ".aws/config" },
  { provider: "GKE", label: "gcloud config", relPath: ".config/gcloud/properties" },
  {
    provider: "GKE",
    label: "gcloud credentials",
    relPath: ".config/gcloud/application_default_credentials.json",
  },
  { provider: "AKS", label: "Azure config", relPath: ".azure/config" },
  { provider: "AKS", label: "Azure profile", relPath: ".azure/azureProfile.json" },
  { provider: "DigitalOcean", label: "doctl config", relPath: ".config/doctl/config.yaml" },
  { provider: "Hetzner", label: "hcloud config", relPath: ".config/hcloud/cli.toml" },
  { provider: "Hetzner", label: "hcloud context", relPath: ".config/hcloud/context.json" },
  { provider: "Hetzner", label: "hcloud config (alt)", relPath: ".hcloud/cli.toml" },
] as const;

// ── Install manifest types ───────────────────────────────────────

export type ManifestToolEntry = {
  version?: string;
  file?: string;
  sha256?: string;
  updatedAt?: string;
};

export type InstallManifest = {
  tools?: Record<string, ManifestToolEntry>;
};
