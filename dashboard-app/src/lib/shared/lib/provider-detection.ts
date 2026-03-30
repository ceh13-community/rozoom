export type ClusterProvider =
  | "AWS EKS"
  | "GKE"
  | "AKS"
  | "DigitalOcean"
  | "Hetzner"
  | "OKE"
  | "OpenShift"
  | "RKE"
  | "K3s"
  | "Minikube"
  | "Kind"
  | "K3d"
  | "Docker Desktop"
  | "Rancher Desktop"
  | "Colima"
  | "Bare metal"
  | "Unknown";

export type ClusterProviderCategory = "managed-cloud" | "local-runtime" | "self-managed";

export type ProviderDetectionInput = {
  clusterName: string;
  contextName?: string | null;
  serverUrl?: string | null;
  execCommand?: string | null;
  execArgs?: string[] | null;
  authProvider?: string | null;
};

export type ProviderDetectionResult = {
  provider: ClusterProvider;
  category: ClusterProviderCategory;
  region: string | null;
  authMethod: string;
};

// ── Server URL patterns (highest fidelity) ─────────────────────

const SERVER_URL_RULES: Array<{ provider: ClusterProvider; match: (host: string) => boolean }> = [
  { provider: "AWS EKS", match: (h) => h.endsWith(".eks.amazonaws.com") },
  { provider: "GKE", match: (h) => h.endsWith(".googleapis.com") },
  { provider: "AKS", match: (h) => h.endsWith(".azmk8s.io") },
  { provider: "DigitalOcean", match: (h) => h.endsWith(".k8s.ondigitalocean.com") },
  { provider: "Hetzner", match: (h) => h.endsWith(".hcloud.app") },
  { provider: "OKE", match: (h) => h.endsWith(".oraclecloud.com") },
];

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "host.docker.internal"]);

// ── Exec command patterns (second priority) ─────────────────────

const EXEC_RULES: Array<{ provider: ClusterProvider; match: RegExp }> = [
  { provider: "AWS EKS", match: /\baws\b|aws-iam-authenticator/i },
  { provider: "GKE", match: /gke-gcloud-auth-plugin|gcloud/i },
  { provider: "AKS", match: /\bkubelogin\b/i },
  { provider: "DigitalOcean", match: /\bdoctl\b/i },
  { provider: "OpenShift", match: /\boc\b/i },
];

// ── Name/context patterns (fallback) ────────────────────────────

const NAME_RULES: Array<{ provider: ClusterProvider; match: RegExp }> = [
  { provider: "AWS EKS", match: /\beks\b|arn:aws:eks|amazon|aws/i },
  { provider: "GKE", match: /\bgke[\b_]|google|gcp/i },
  { provider: "AKS", match: /\baks\b|azure/i },
  { provider: "DigitalOcean", match: /digitalocean|\bdo-\b|\bdoks\b/i },
  { provider: "Hetzner", match: /hetzner|\bhcloud\b/i },
  { provider: "OKE", match: /\boke\b|oracle/i },
  { provider: "OpenShift", match: /openshift|\bocp\b/i },
  { provider: "RKE", match: /\brke\b|rancher/i },
  { provider: "K3s", match: /\bk3s\b/i },
  { provider: "Minikube", match: /\bminikube\b/i },
  { provider: "Kind", match: /\bkind\b/i },
  { provider: "K3d", match: /\bk3d\b/i },
  { provider: "Docker Desktop", match: /docker-desktop|docker\.internal/i },
  { provider: "Rancher Desktop", match: /rancher-desktop/i },
  { provider: "Colima", match: /\bcolima\b/i },
  { provider: "Bare metal", match: /bare[\s-]?metal|on-?prem/i },
];

// ── Category mapping ────────────────────────────────────────────

const MANAGED_CLOUD: Set<ClusterProvider> = new Set([
  "AWS EKS",
  "GKE",
  "AKS",
  "DigitalOcean",
  "Hetzner",
  "OKE",
]);

const LOCAL_RUNTIME: Set<ClusterProvider> = new Set([
  "Minikube",
  "Kind",
  "K3d",
  "Docker Desktop",
  "Rancher Desktop",
  "Colima",
]);

export function getProviderCategory(provider: ClusterProvider): ClusterProviderCategory {
  if (MANAGED_CLOUD.has(provider)) return "managed-cloud";
  if (LOCAL_RUNTIME.has(provider)) return "local-runtime";
  return "self-managed";
}

// ── Region extraction ───────────────────────────────────────────

const REGION_PATTERNS: Array<{
  provider: ClusterProvider;
  extract: (url: string, name: string) => string | null;
}> = [
  {
    // AWS: https://<id>.<region>.eks.amazonaws.com
    provider: "AWS EKS",
    extract: (url, name) => {
      const urlMatch = url.match(/\.([a-z]{2}-[a-z]+-\d)\.eks\.amazonaws\.com/);
      if (urlMatch) return urlMatch[1];
      const nameMatch = name.match(/[a-z]{2}-[a-z]+-\d/);
      return nameMatch ? nameMatch[0] : null;
    },
  },
  {
    // GKE: zones like us-central1-a or regions like us-central1
    provider: "GKE",
    extract: (_url, name) => {
      const m = name.match(/([a-z]+-[a-z]+\d(?:-[a-z])?)/);
      return m ? m[1] : null;
    },
  },
  {
    // AKS: regions like eastus, westeurope, etc.
    provider: "AKS",
    extract: (_url, name) => {
      const azureRegions =
        /\b(eastus2?|westus[23]?|centralus|northeurope|westeurope|uksouth|eastasia|southeastasia|japaneast|australiaeast|canadacentral|brazilsouth|koreacentral|francecentral|germanywestcentral|norwayeast|swedencentral|switzerlandnorth)\b/i;
      const m = name.match(azureRegions);
      return m ? m[1].toLowerCase() : null;
    },
  },
  {
    // DigitalOcean: https://<id>.<region>.k8s.ondigitalocean.com
    provider: "DigitalOcean",
    extract: (url, name) => {
      const urlMatch = url.match(/[.-]([a-z]{3}\d)\.k8s\.ondigitalocean\.com/);
      if (urlMatch) return urlMatch[1];
      const doRegions = /\b(nyc[123]|sfo[123]|ams[23]|sgp1|lon1|fra1|tor1|blr1|syd1)\b/i;
      const m = name.match(doRegions);
      return m ? m[1].toLowerCase() : null;
    },
  },
  {
    // Hetzner: https://<id>.<region>.hcloud.app
    provider: "Hetzner",
    extract: (url, name) => {
      const urlMatch = url.match(/\.([a-z]{3}\d)\.hcloud\.app/);
      if (urlMatch) return urlMatch[1];
      const hetzRegions = /\b(fsn1|nbg1|hel1|ash|hil)\b/i;
      const m = name.match(hetzRegions);
      return m ? m[1].toLowerCase() : null;
    },
  },
];

export function extractRegion(
  provider: ClusterProvider,
  serverUrl: string | null,
  clusterName: string | null,
): string | null {
  const rule = REGION_PATTERNS.find((r) => r.provider === provider);
  if (rule) return rule.extract(serverUrl ?? "", clusterName ?? "");

  // Generic fallback: AWS-style region pattern in name
  const fallback = (clusterName ?? "").match(/[a-z]{2}-[a-z]+-\d/);
  return fallback ? fallback[0] : null;
}

// ── Auth method detection ───────────────────────────────────────

function detectAuthMethod(input: ProviderDetectionInput): string {
  if (input.execCommand) {
    const cmd = input.execCommand.split("/").pop() ?? input.execCommand;
    return `exec: ${cmd}`;
  }
  if (input.authProvider) return `auth-provider: ${input.authProvider}`;
  return "certificate";
}

// ── Main detection function ─────────────────────────────────────

function extractHost(serverUrl: string): string {
  try {
    return new URL(serverUrl).hostname;
  } catch {
    return "";
  }
}

function detectFromServerUrl(host: string, input: ProviderDetectionInput): ClusterProvider | null {
  if (!host) return null;

  // Check cloud providers
  for (const rule of SERVER_URL_RULES) {
    if (rule.match(host)) return rule.provider;
  }

  // Check local
  if (LOCAL_HOSTS.has(host) || host.endsWith(".docker.internal")) {
    return detectLocalRuntime(input.clusterName, input.contextName ?? null);
  }

  return null;
}

function detectFromExec(input: ProviderDetectionInput): ClusterProvider | null {
  const hint = input.execCommand ?? "";
  const argsHint = (input.execArgs ?? []).join(" ");
  const combined = `${hint} ${argsHint}`;
  if (!combined.trim()) return null;

  for (const rule of EXEC_RULES) {
    if (rule.match.test(combined)) return rule.provider;
  }
  return null;
}

function detectFromName(clusterName: string, contextName: string | null): ClusterProvider | null {
  const hint = `${clusterName} ${contextName ?? ""}`;
  for (const rule of NAME_RULES) {
    if (rule.match.test(hint)) return rule.provider;
  }
  return null;
}

function detectLocalRuntime(clusterName: string, contextName: string | null): ClusterProvider {
  const hint = `${clusterName} ${contextName ?? ""}`.toLowerCase();
  if (hint.includes("minikube")) return "Minikube";
  if (hint.includes("kind")) return "Kind";
  if (hint.includes("k3d")) return "K3d";
  if (hint.includes("docker-desktop") || hint.includes("docker.internal")) return "Docker Desktop";
  if (hint.includes("rancher-desktop")) return "Rancher Desktop";
  if (hint.includes("colima")) return "Colima";
  return "Minikube"; // generic local fallback
}

function isLikelyRealCluster(serverUrl: string | null): boolean {
  if (!serverUrl) return false;
  const host = extractHost(serverUrl);
  return !!host && !LOCAL_HOSTS.has(host) && !host.endsWith(".docker.internal");
}

export function detectClusterProvider(input: ProviderDetectionInput): ProviderDetectionResult {
  const host = input.serverUrl ? extractHost(input.serverUrl) : "";

  // Priority 1: server URL
  const fromUrl = detectFromServerUrl(host, input);

  // Priority 2: exec command
  const fromExec = !fromUrl ? detectFromExec(input) : null;

  // Priority 3: name/context patterns
  const fromName =
    !fromUrl && !fromExec ? detectFromName(input.clusterName, input.contextName ?? null) : null;

  let provider: ClusterProvider = fromUrl ?? fromExec ?? fromName ?? "Unknown";

  // If still unknown but server URL is a real IP/host (not local), mark as bare metal
  if (provider === "Unknown" && isLikelyRealCluster(input.serverUrl ?? null)) {
    provider = "Bare metal";
  }

  const category = getProviderCategory(provider);
  const region = extractRegion(provider, input.serverUrl ?? null, input.clusterName);
  const authMethod = detectAuthMethod(input);

  return { provider, category, region, authMethod };
}
