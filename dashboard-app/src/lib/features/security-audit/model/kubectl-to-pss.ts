/**
 * Map `kubectl get pods -A -o json` responses to the input shape expected by
 * `buildPssReport` (Pod Security Standards compliance checker).
 *
 * Pod Security Standards are defined by Kubernetes upstream:
 *   https://kubernetes.io/docs/concepts/security/pod-security-standards/
 *
 * The checker needs pod-level security context + host namespace flags + the
 * full container list (including init + ephemeral containers, both of which
 * count for compliance).
 */

type K8sSecurityContext = {
  privileged?: boolean;
  runAsNonRoot?: boolean;
  runAsUser?: number;
  readOnlyRootFilesystem?: boolean;
  allowPrivilegeEscalation?: boolean;
  capabilities?: { add?: string[]; drop?: string[] };
  seccompProfile?: { type?: string };
};

type K8sContainer = {
  name?: string;
  securityContext?: K8sSecurityContext;
  ports?: Array<{ hostPort?: number }>;
};

type K8sPodVolume = {
  hostPath?: { path?: string };
};

type K8sPodItem = {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  spec?: {
    hostNetwork?: boolean;
    hostPID?: boolean;
    hostIPC?: boolean;
    volumes?: K8sPodVolume[];
    securityContext?: K8sSecurityContext;
    containers?: K8sContainer[];
    initContainers?: K8sContainer[];
    ephemeralContainers?: K8sContainer[];
  };
};

export type PodScanInput = {
  namespace: string;
  pod: string;
  hostNetwork?: boolean;
  hostPID?: boolean;
  hostIPC?: boolean;
  volumes?: Array<{ hostPath?: { path: string } }>;
  securityContext?: K8sSecurityContext;
  containers: Array<{
    name: string;
    securityContext?: K8sSecurityContext;
    ports?: Array<{ hostPort?: number }>;
  }>;
  initContainers?: Array<{
    name: string;
    securityContext?: K8sSecurityContext;
    ports?: Array<{ hostPort?: number }>;
  }>;
  ephemeralContainers?: Array<{
    name: string;
    securityContext?: K8sSecurityContext;
    ports?: Array<{ hostPort?: number }>;
  }>;
};

function normalizeContainer(c: K8sContainer): PodScanInput["containers"][number] | null {
  if (!c.name) return null;
  return {
    name: c.name,
    securityContext: c.securityContext,
    ports: c.ports,
  };
}

function normalizeContainers(list: K8sContainer[] | undefined): PodScanInput["containers"] {
  if (!list) return [];
  const out: PodScanInput["containers"] = [];
  for (const c of list) {
    const norm = normalizeContainer(c);
    if (norm) out.push(norm);
  }
  return out;
}

function normalizeVolumes(list: K8sPodVolume[] | undefined): PodScanInput["volumes"] | undefined {
  if (!list) return undefined;
  const out: NonNullable<PodScanInput["volumes"]> = [];
  for (const v of list) {
    if (v.hostPath?.path) {
      out.push({ hostPath: { path: v.hostPath.path } });
    }
  }
  return out.length > 0 ? out : undefined;
}

function normalizePod(item: K8sPodItem): PodScanInput | null {
  const pod = item.metadata?.name;
  const namespace = item.metadata?.namespace;
  if (!pod || !namespace) return null;

  const containers = normalizeContainers(item.spec?.containers);
  // A pod with zero normal containers would never be scheduled; skip as
  // malformed input rather than running the scanner on it.
  if (containers.length === 0) return null;

  const init = normalizeContainers(item.spec?.initContainers);
  const ephemeral = normalizeContainers(item.spec?.ephemeralContainers);

  return {
    namespace,
    pod,
    hostNetwork: item.spec?.hostNetwork,
    hostPID: item.spec?.hostPID,
    hostIPC: item.spec?.hostIPC,
    volumes: normalizeVolumes(item.spec?.volumes),
    securityContext: item.spec?.securityContext,
    containers,
    initContainers: init.length > 0 ? init : undefined,
    ephemeralContainers: ephemeral.length > 0 ? ephemeral : undefined,
  };
}

export function normalizePodsForPss(response: { items?: K8sPodItem[] } | null): PodScanInput[] {
  const out: PodScanInput[] = [];
  for (const raw of response?.items ?? []) {
    const norm = normalizePod(raw);
    if (norm) out.push(norm);
  }
  return out;
}
