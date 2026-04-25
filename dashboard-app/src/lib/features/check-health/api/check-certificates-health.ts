import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { isCommandUnavailableProbeError } from "$shared/lib/runtime-probe-errors";
import type {
  CertificateItem,
  CertificateStatus,
  CertificatesReport,
  KubeletRotationItem,
  KubeletRotationStatus,
} from "../model/types";

const CERT_CACHE_MS = 24 * 60 * 60 * 1000;
const ROTATION_CACHE_MS = 60 * 60 * 1000;
const WARNING_DAYS = 30;
const KUBECTL_CALL_TIMEOUT_MS = 12_000;

const CONTROL_PLANE_NAMESPACE = "kube-system";
const CONTROL_PLANE_LABELS = ["component=kube-apiserver", "k8s-app=kube-apiserver"];

const cachedCertificates = new Map<
  string,
  {
    report: CertificatesReport;
    certsFetchedAt: number;
    rotationFetchedAt: number;
  }
>();

async function logCertificateProbeErrorIfUnexpected(message: string) {
  if (isCommandUnavailableProbeError(message)) return;
  await logError(message);
}

type PodList = {
  items?: Array<{ metadata?: { name?: string }; status?: { phase?: string } }>;
};

type NodeList = {
  items?: Array<{ metadata?: { name?: string } }>;
};

type KubeletConfigz = {
  kubeletconfig?: {
    rotateCertificates?: boolean;
    serverTLSBootstrap?: boolean;
  };
};

type CsrItem = {
  metadata?: { name?: string; creationTimestamp?: string };
  spec?: {
    signerName?: string;
    username?: string;
  };
  status?: {
    conditions?: Array<{ type?: string; status?: string }>;
  };
};

type CsrList = { items?: CsrItem[] };

/**
 * Node name → CSR evidence. A node with an approved CSR for either
 * signer in the last 30 days is treated as proof that rotation is
 * active, even when `/nodes/<node>/proxy/configz` is unavailable.
 */
type CsrEvidence = {
  hasServerCsr: boolean;
  hasClientCsr: boolean;
  lastApprovedAt?: string;
};

const CSR_EVIDENCE_WINDOW_DAYS = 60;

function isCsrApproved(csr: CsrItem): boolean {
  return Boolean(
    csr.status?.conditions?.some(
      (c) => c.type === "Approved" && (c.status === "True" || c.status === undefined),
    ),
  );
}

function nodeNameFromCsrUsername(username?: string): string | null {
  // Kubelet CSR usernames are of the form `system:node:<name>` for
  // both kubelet-serving (server) and kube-apiserver-client-kubelet
  // (client) signers.
  if (!username) return null;
  const prefix = "system:node:";
  return username.startsWith(prefix) ? username.slice(prefix.length) : null;
}

async function fetchKubeletCsrEvidence(clusterId: string): Promise<Map<string, CsrEvidence>> {
  const result = new Map<string, CsrEvidence>();
  try {
    const response = await kubectlWithTimeout(
      "get csr -o json",
      clusterId,
      KUBECTL_CALL_TIMEOUT_MS,
      "kubelet-rotation csr list",
      "check-certificates-health:csr-list",
      true,
    );
    if (response.errors || response.code !== 0) return result;
    const parsed = parseJson(response.output) as CsrList | null;
    const items = parsed?.items ?? [];
    const cutoff = Date.now() - CSR_EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    for (const csr of items) {
      if (!isCsrApproved(csr)) continue;
      const createdAt = csr.metadata?.creationTimestamp;
      if (!createdAt) continue;
      const ts = Date.parse(createdAt);
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      const node = nodeNameFromCsrUsername(csr.spec?.username);
      if (!node) continue;
      const signer = csr.spec?.signerName ?? "";
      const entry = result.get(node) ?? { hasServerCsr: false, hasClientCsr: false };
      if (signer === "kubernetes.io/kubelet-serving") entry.hasServerCsr = true;
      if (signer === "kubernetes.io/kube-apiserver-client-kubelet") entry.hasClientCsr = true;
      if (!entry.lastApprovedAt || createdAt > entry.lastApprovedAt) {
        entry.lastApprovedAt = createdAt;
      }
      result.set(node, entry);
    }
  } catch {
    // Best effort; absence of CSRs just means we stay "unknown".
  }
  return result;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

async function kubectlWithTimeout(
  command: string,
  clusterId: string,
  timeoutMs: number,
  label: string,
  source?: string,
  allowCommandUnavailable?: boolean,
) {
  const controller = new AbortController();
  try {
    return await withTimeout(
      kubectlRawFront(command, {
        clusterId,
        source,
        allowCommandUnavailable,
        signal: controller.signal,
      }),
      timeoutMs,
      label,
    );
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    controller.abort();
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isPodList(value: unknown): value is PodList {
  if (!value || typeof value !== "object") return false;
  if (!("items" in value)) return false;
  const list = value as { items?: unknown };
  return Array.isArray(list.items);
}

function isNodeList(value: unknown): value is NodeList {
  if (!value || typeof value !== "object") return false;
  if (!("items" in value)) return false;
  const list = value as { items?: unknown };
  return Array.isArray(list.items);
}

async function findControlPlanePod(clusterId: string): Promise<string | null> {
  for (const label of CONTROL_PLANE_LABELS) {
    const response = await kubectlWithTimeout(
      `get pods -n ${CONTROL_PLANE_NAMESPACE} -l ${label} -o json`,
      clusterId,
      KUBECTL_CALL_TIMEOUT_MS,
      "find-control-plane-pod kubectl call",
      "check-certificates-health:find-control-plane-pod",
    );
    const parsed = parseJson(response.output);
    if (!parsed || !isPodList(parsed)) continue;
    const pod = parsed.items?.find((item) => item.status?.phase === "Running");
    if (pod?.metadata?.name) return pod.metadata.name;
  }
  return null;
}

function parseResidualDays(value?: string): number | undefined {
  if (!value) return undefined;
  const daysMatch = value.match(/(\d+)\s*d/i);
  if (daysMatch) return Number(daysMatch[1]);
  const hoursMatch = value.match(/(\d+)\s*h/i);
  if (hoursMatch) return Number(hoursMatch[1]) / 24;
  return undefined;
}

function computeDaysLeft(expiresAt?: string, residual?: string): number | undefined {
  const residualDays = parseResidualDays(residual);
  if (residualDays !== undefined) return residualDays;
  if (!expiresAt) return undefined;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return undefined;
  return (expiry - Date.now()) / (1000 * 60 * 60 * 24);
}

function parseKubeadmOutput(output: string): CertificateItem[] {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const items: CertificateItem[] = [];
  for (const line of lines) {
    if (line.startsWith("CERTIFICATE") || line.startsWith("CERTIFICATE AUTHORITY")) continue;
    if (line.startsWith("CERTIFICATE AUTHORITY")) continue;
    if (line.startsWith("CERTIFICATE")) continue;
    const columns = line.split(/\s{2,}/);
    if (columns.length < 3) continue;
    const [name, expiresAt, residual] = columns;
    const daysLeft = computeDaysLeft(expiresAt, residual);
    let status: CertificateStatus = "unknown";
    if (daysLeft !== undefined) {
      if (daysLeft <= 0) status = "critical";
      else if (daysLeft < WARNING_DAYS) status = "warning";
      else status = "ok";
    }
    items.push({
      name,
      expiresAt,
      residual,
      daysLeft,
      status,
    });
  }
  return items;
}

function buildSummary(
  certificates: CertificateItem[],
  rotation: KubeletRotationItem[],
  errorMessage?: string,
): { status: CertificateStatus; warnings: string[]; message?: string } {
  const warnings: string[] = [];
  if (errorMessage) {
    return {
      status: "unknown",
      warnings: [errorMessage],
      message: "Unable to check certificates.",
    };
  }

  const hasCriticalCert = certificates.some((item) => item.status === "critical");
  const hasWarningCert = certificates.some((item) => item.status === "warning");
  const rotationDisabled = rotation.some((item) => item.status === "disabled");
  const rotationUnknown = rotation.some((item) => item.status === "unknown");

  let status: CertificateStatus = "ok";
  if (hasCriticalCert) {
    status = "critical";
    warnings.push("One or more control-plane certificates are expired.");
  } else if (hasWarningCert) {
    status = "warning";
    warnings.push("Some control-plane certificates are expiring soon.");
  }

  if (rotationDisabled) {
    if (status !== "critical") status = "warning";
    warnings.push("Kubelet certificate rotation appears disabled on some nodes.");
  } else if (rotationUnknown && status === "ok") {
    status = "unknown";
    warnings.push("Unable to verify kubelet certificate rotation on all nodes.");
  }

  const soonest = certificates
    .map((item) => item.daysLeft)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b)[0];
  const message = Number.isFinite(soonest)
    ? `Certificates expire in ${Math.max(0, Math.floor(soonest))} days`
    : "No certificate data.";

  return { status, warnings, message };
}

async function checkKubeletRotation(clusterId: string): Promise<KubeletRotationItem[]> {
  const response = await kubectlWithTimeout(
    "get nodes -o json",
    clusterId,
    KUBECTL_CALL_TIMEOUT_MS,
    "kubelet-rotation list-nodes call",
  );
  if (response.errors || response.code !== 0) {
    await logError(`Failed to list nodes for kubelet rotation: ${response.errors}`);
    return [];
  }
  const parsed = parseJson(response.output);
  if (!parsed || !isNodeList(parsed)) return [];
  const nodes = parsed.items?.map((item) => item.metadata?.name).filter(Boolean) ?? [];

  const results: KubeletRotationItem[] = [];
  if (nodes.length === 0) return results;

  // Pull CSR evidence once so we can infer rotation status on nodes
  // where `/proxy/configz` is unavailable (managed clusters, blocked
  // kubelet auth, broken metrics pipeline, etc.). An approved
  // kubernetes.io/kubelet-serving or kube-apiserver-client-kubelet
  // CSR in the last 60 days is strong evidence that rotation is on.
  const csrEvidence = await fetchKubeletCsrEvidence(clusterId);
  for (const node of nodes) {
    if (!node) continue;
    const evidence = csrEvidence.get(node);
    try {
      const safeConfigResponse = await kubectlWithTimeout(
        `get --raw /api/v1/nodes/${node}/proxy/configz`,
        clusterId,
        KUBECTL_CALL_TIMEOUT_MS,
        `kubelet-rotation configz ${node} call`,
      );
      if (safeConfigResponse.errors || safeConfigResponse.code !== 0) {
        // Fallback: infer from CSR approvals if we saw any recently.
        if (evidence && (evidence.hasClientCsr || evidence.hasServerCsr)) {
          results.push({
            node,
            rotateClient: evidence.hasClientCsr || undefined,
            rotateServer: evidence.hasServerCsr || undefined,
            status: "enabled",
            message: `Inferred from approved CSR at ${evidence.lastApprovedAt}`,
          });
        } else {
          results.push({
            node,
            status: "unknown",
            message:
              "Kubelet /proxy/configz unreachable and no recent kubelet CSR found. " +
              "Common on managed clusters; check provider rotation policy.",
          });
        }
        continue;
      }
      const config = parseJson(safeConfigResponse.output) as KubeletConfigz | null;
      const rotateClient = config?.kubeletconfig?.rotateCertificates;
      const rotateServer = config?.kubeletconfig?.serverTLSBootstrap;
      let status: KubeletRotationStatus = "unknown";
      if (rotateClient || rotateServer) {
        status = "enabled";
      } else if (rotateClient === false && rotateServer === false) {
        status = "disabled";
      }
      results.push({
        node,
        rotateClient: rotateClient ?? undefined,
        rotateServer: rotateServer ?? undefined,
        status,
      });
    } catch (error) {
      if (evidence && (evidence.hasClientCsr || evidence.hasServerCsr)) {
        results.push({
          node,
          rotateClient: evidence.hasClientCsr || undefined,
          rotateServer: evidence.hasServerCsr || undefined,
          status: "enabled",
          message: `Inferred from approved CSR at ${evidence.lastApprovedAt}`,
        });
        continue;
      }
      const message =
        error instanceof Error ? error.message : "Node unreachable for certificate check.";
      results.push({ node, status: "unknown", message });
    }
  }

  return results;
}

async function checkControlPlaneCerts(
  clusterId: string,
): Promise<{ certificates: CertificateItem[]; controlPlaneDetected: boolean }> {
  const podName = await findControlPlanePod(clusterId);
  if (!podName) {
    // Managed control plane (Rancher, RKE2, EKS, GKE, AKS): no
    // kube-apiserver static pod exposed in kube-system. Not an error -
    // just a different cluster topology. Caller decides how to message.
    return { certificates: [], controlPlaneDetected: false };
  }
  const result = await kubectlWithTimeout(
    `exec -n ${CONTROL_PLANE_NAMESPACE} ${podName} -- kubeadm certs check-expiration`,
    clusterId,
    KUBECTL_CALL_TIMEOUT_MS,
    "control-plane-certs kubectl call",
    "check-certificates-health:control-plane-certs",
    true,
  );
  if (result.errors || result.code !== 0) {
    await logCertificateProbeErrorIfUnexpected(
      `kubeadm certs check-expiration failed: ${result.errors || result.output}`,
    );
    return { certificates: [], controlPlaneDetected: true };
  }
  return { certificates: parseKubeadmOutput(result.output), controlPlaneDetected: true };
}

export async function checkCertificatesHealth(
  clusterId: string,
  options?: { force?: boolean },
): Promise<CertificatesReport> {
  const cached = cachedCertificates.get(clusterId);
  const now = Date.now();
  const shouldRefreshCerts =
    options?.force || !cached || now - cached.certsFetchedAt > CERT_CACHE_MS;
  const shouldRefreshRotation =
    options?.force || !cached || now - cached.rotationFetchedAt > ROTATION_CACHE_MS;

  let certificates = cached?.report.certificates ?? [];
  let kubeletRotation = cached?.report.kubeletRotation ?? [];
  let errorMessage: string | undefined;
  let controlPlaneDetected: boolean | undefined = cached?.report.controlPlaneDetected;

  try {
    if (shouldRefreshCerts) {
      const result = await checkControlPlaneCerts(clusterId);
      certificates = result.certificates;
      controlPlaneDetected = result.controlPlaneDetected;
    }
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Unable to check control-plane certificates.";
    await logError(`Control-plane cert check failed: ${errorMessage}`);
  }

  try {
    if (shouldRefreshRotation) {
      kubeletRotation = await checkKubeletRotation(clusterId);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to check kubelet rotation status.";
    errorMessage = errorMessage ?? message;
    await logError(`Kubelet rotation check failed: ${message}`);
  }

  // Managed control plane is an expected state, not a failure - don't
  // surface a scary "Unable to check certificates" message.
  if (
    !certificates.length &&
    !kubeletRotation.length &&
    !errorMessage &&
    controlPlaneDetected !== false
  ) {
    errorMessage = "Unable to check certificates.";
  }

  const summary = buildSummary(certificates, kubeletRotation, errorMessage);
  const report: CertificatesReport = {
    status: summary.status,
    summary: { ...summary, updatedAt: Date.now() },
    certificates,
    kubeletRotation,
    controlPlaneDetected,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  let certsFetchedAt = now;
  let rotationFetchedAt = now;
  if (cached) {
    certsFetchedAt = shouldRefreshCerts ? now : cached.certsFetchedAt;
    rotationFetchedAt = shouldRefreshRotation ? now : cached.rotationFetchedAt;
  }

  cachedCertificates.set(clusterId, {
    report,
    certsFetchedAt,
    rotationFetchedAt,
  });

  return report;
}
