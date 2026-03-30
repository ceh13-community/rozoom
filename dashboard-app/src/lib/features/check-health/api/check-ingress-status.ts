import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { IngressStatusReport } from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: IngressStatusReport; fetchedAt: number }>();

function parseLine(line: string): {
  namespace: string;
  name: string;
  hosts: string;
  hasTls: boolean;
} | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 4) return null;
  const namespace = parts[0];
  const name = parts[1];
  const hosts = parts[2];
  const tlsRaw = parts[3];
  const hasTls = tlsRaw !== "<none>" && tlsRaw.length > 0;
  return { namespace, name, hosts, hasTls };
}

export async function checkIngressStatus(
  clusterId: string,
  options?: { force?: boolean },
): Promise<IngressStatusReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  const items: Array<{ namespace: string; name: string; hosts: string; hasTls: boolean }> = [];

  try {
    const result = await kubectlRawFront(
      `get ingresses --all-namespaces --no-headers -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,HOSTS:.spec.rules[*].host,TLS:.spec.tls[*].secretName`,
      { clusterId },
    );
    if (result.errors && result.code !== 0) {
      errorMessage = result.errors || "Failed to fetch ingress data.";
      await logError(`Ingress status check failed: ${errorMessage}`);
    } else {
      const lines = result.output.split("\n");
      for (const line of lines) {
        const parsed = parseLine(line);
        if (parsed) items.push(parsed);
      }
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch ingress data.";
    await logError(`Ingress status check failed: ${errorMessage}`);
  }

  const total = items.length;
  const withTls = items.filter((i) => i.hasTls).length;
  const withoutTls = total - withTls;

  let status: "ok" | "warning" | "critical" | "unknown";
  let message: string;

  if (errorMessage) {
    status = "unknown";
    message = "Ingress data unavailable.";
  } else if (total === 0) {
    status = "unknown";
    message = "No ingresses found.";
  } else if (withoutTls > 0) {
    status = "warning";
    message = `${total} routes (${withoutTls} no TLS)`;
  } else {
    status = "ok";
    message = `${total} routes`;
  }

  const report: IngressStatusReport = {
    status,
    summary: { status, message, total, withTls, withoutTls, updatedAt: Date.now() },
    items,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
