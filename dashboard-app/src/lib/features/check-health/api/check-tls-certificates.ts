import { kubectlJson } from "$shared/api/kubectl-proxy";

export interface TlsCertInfo {
  name: string;
  namespace: string;
  type: "tls-secret" | "cert-manager";
  dnsNames: string[];
  notAfter: string | null;
  daysLeft: number | null;
  status: "ok" | "warning" | "critical" | "unknown";
  issuer: string | null;
  renewAction: string | null;
}

export interface TlsCertScanResult {
  certs: TlsCertInfo[];
  certManagerAvailable: boolean;
  errors: string[];
  scannedAt: number;
}

const WARN_DAYS = 30;
const CERT_SCAN_CACHE_MS = 5 * 60 * 1000;
const cachedScans = new Map<string, { result: TlsCertScanResult; fetchedAt: number }>();

function computeStatus(daysLeft: number | null): TlsCertInfo["status"] {
  if (daysLeft === null) return "unknown";
  if (daysLeft <= 0) return "critical";
  if (daysLeft <= WARN_DAYS) return "warning";
  return "ok";
}

function daysUntil(dateStr: string): number | null {
  const date = new Date(dateStr);
  if (!Number.isFinite(date.getTime())) return null;
  return Math.floor((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function parseX509NotAfter(pemBase64: string): string | null {
  try {
    const pem = atob(pemBase64);
    const match = pem.match(/Not\s+After\s*:\s*(.+?)[\r\n]/i);
    if (match) return new Date(match[1]).toISOString();

    const certMatch = pem.match(
      /-----BEGIN CERTIFICATE-----\s*([\s\S]*?)\s*-----END CERTIFICATE-----/,
    );
    if (!certMatch) return null;
    const derB64 = certMatch[1].replace(/\s/g, "");
    const der = Uint8Array.from(atob(derB64), (c) => c.charCodeAt(0));
    return parseNotAfterFromDer(der);
  } catch {
    return null;
  }
}

function parseNotAfterFromDer(der: Uint8Array): string | null {
  try {
    const asn1Str = new TextDecoder("ascii", { fatal: false }).decode(der);
    const utcTimePattern = /(\d{12}Z)/g;
    const genTimePattern = /(\d{14}Z)/g;

    const utcMatches = [...asn1Str.matchAll(utcTimePattern)].map((m) => m[1]);
    const genMatches = [...asn1Str.matchAll(genTimePattern)].map((m) => m[1]);

    const allDates: Date[] = [];
    for (const m of utcMatches) {
      const yr = parseInt(m.slice(0, 2), 10);
      const year = yr >= 50 ? 1900 + yr : 2000 + yr;
      const d = new Date(
        Date.UTC(
          year,
          parseInt(m.slice(2, 4), 10) - 1,
          parseInt(m.slice(4, 6), 10),
          parseInt(m.slice(6, 8), 10),
          parseInt(m.slice(8, 10), 10),
          parseInt(m.slice(10, 12), 10),
        ),
      );
      if (Number.isFinite(d.getTime())) allDates.push(d);
    }
    for (const m of genMatches) {
      const d = new Date(
        Date.UTC(
          parseInt(m.slice(0, 4), 10),
          parseInt(m.slice(4, 6), 10) - 1,
          parseInt(m.slice(6, 8), 10),
          parseInt(m.slice(8, 10), 10),
          parseInt(m.slice(10, 12), 10),
          parseInt(m.slice(12, 14), 10),
        ),
      );
      if (Number.isFinite(d.getTime())) allDates.push(d);
    }

    if (allDates.length < 2) return null;
    allDates.sort((a, b) => a.getTime() - b.getTime());
    return allDates[allDates.length - 1].toISOString();
  } catch {
    return null;
  }
}

async function scanTlsSecrets(
  clusterId: string,
): Promise<{ certs: TlsCertInfo[]; errors: string[] }> {
  const certs: TlsCertInfo[] = [];
  const errors: string[] = [];

  const result = await kubectlJson<{
    items?: Array<{
      metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> };
      data?: { "tls.crt"?: string };
    }>;
  }>("get secrets --all-namespaces --field-selector type=kubernetes.io/tls", { clusterId });

  if (typeof result === "string") {
    if (!result.includes("not found") && !result.includes("No resources")) {
      errors.push(`TLS secrets: ${result}`);
    }
    return { certs, errors };
  }

  const items = result.items ?? [];
  for (const item of items) {
    const name = item.metadata?.name ?? "unknown";
    const namespace = item.metadata?.namespace ?? "default";
    const certData = item.data?.["tls.crt"];

    let notAfter: string | null = null;
    if (certData) {
      notAfter = parseX509NotAfter(certData);
    }

    const days = notAfter ? daysUntil(notAfter) : null;
    const annotations = item.metadata?.annotations ?? {};
    const isCertManager = Boolean(
      annotations["cert-manager.io/certificate-name"] || annotations["cert-manager.io/issuer-name"],
    );

    certs.push({
      name,
      namespace,
      type: isCertManager ? "cert-manager" : "tls-secret",
      dnsNames: [],
      notAfter,
      daysLeft: days,
      status: computeStatus(days),
      issuer: annotations["cert-manager.io/issuer-name"] ?? null,
      renewAction: isCertManager ? `kubectl cert-manager renew ${name} -n ${namespace}` : null,
    });
  }

  return { certs, errors };
}

async function scanCertManagerCerts(clusterId: string): Promise<{
  certs: TlsCertInfo[];
  available: boolean;
  errors: string[];
}> {
  const certs: TlsCertInfo[] = [];
  const errors: string[] = [];

  const result = await kubectlJson<{
    items?: Array<{
      metadata?: { name?: string; namespace?: string };
      spec?: { dnsNames?: string[]; issuerRef?: { name?: string; kind?: string } };
      status?: {
        notAfter?: string;
        conditions?: Array<{ type?: string; status?: string; message?: string }>;
      };
    }>;
  }>("get certificates.cert-manager.io --all-namespaces", { clusterId });

  if (typeof result === "string") {
    const notInstalled =
      result.includes("the server doesn't have a resource type") ||
      result.includes("not found") ||
      result.includes("No resources");
    if (!notInstalled) {
      errors.push(`cert-manager: ${result}`);
    }
    return { certs, available: false, errors };
  }

  const items = result.items ?? [];
  for (const item of items) {
    const name = item.metadata?.name ?? "unknown";
    const namespace = item.metadata?.namespace ?? "default";
    const notAfter = item.status?.notAfter ?? null;
    const days = notAfter ? daysUntil(notAfter) : null;
    const readyCondition = item.status?.conditions?.find((c) => c.type === "Ready");
    const isReady = readyCondition?.status === "True";

    let status = computeStatus(days);
    if (!isReady && status === "ok") {
      status = "warning";
    }

    certs.push({
      name,
      namespace,
      type: "cert-manager",
      dnsNames: item.spec?.dnsNames ?? [],
      notAfter,
      daysLeft: days,
      status,
      issuer: item.spec?.issuerRef?.name ?? null,
      renewAction: `kubectl cert-manager renew ${name} -n ${namespace}`,
    });
  }

  return { certs, available: true, errors };
}

export async function scanTlsCertificates(
  clusterId: string,
  options?: { force?: boolean },
): Promise<TlsCertScanResult> {
  const cached = cachedScans.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CERT_SCAN_CACHE_MS) {
    return cached.result;
  }

  const [tlsResult, cmResult] = await Promise.all([
    scanTlsSecrets(clusterId),
    scanCertManagerCerts(clusterId),
  ]);

  const certManagerNames = new Set(cmResult.certs.map((c) => `${c.namespace}/${c.name}`));
  const dedupedTls = tlsResult.certs.filter(
    (c) => !certManagerNames.has(`${c.namespace}/${c.name}`),
  );

  const result: TlsCertScanResult = {
    certs: [...cmResult.certs, ...dedupedTls].sort(
      (a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999),
    ),
    certManagerAvailable: cmResult.available,
    errors: [...tlsResult.errors, ...cmResult.errors],
    scannedAt: Date.now(),
  };

  cachedScans.set(clusterId, { result, fetchedAt: Date.now() });
  return result;
}

export function resetTlsCertCache() {
  cachedScans.clear();
}
