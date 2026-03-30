import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { isExpectedClusterProbeError } from "$shared/lib/runtime-probe-errors";
import { PrometheusClient } from "./resolvers/prometheus-client";
import type { BlackboxProbeItem, BlackboxProbeReport, BlackboxProbeStatus } from "../model/types";
import {
  getFeatureCapability,
  markFeatureCapability,
  markFeatureCapabilityFromReason,
  shouldSkipFeatureProbe,
} from "../model/feature-capability-cache";

const CACHE_MS = 60 * 1000;
const REQUEST_TIMEOUT = "10s";
const MAX_TARGETS = 50;
const TLS_WARNING_DAYS = 7;
const TLS_CRITICAL_DAYS = 1;
const BLACKBOX_PROBES_FEATURE_ID = "blackbox-probes";

const cachedReports = new Map<string, { data: BlackboxProbeReport; fetchedAt: number }>();

type RawIngress = {
  metadata?: { name?: string; namespace?: string };
  spec?: { rules?: Array<{ host?: string }>; tls?: Array<{ hosts?: string[] }> };
};

type RawServicePort = { port?: number; name?: string };
type RawService = {
  metadata?: { name?: string; namespace?: string };
  spec?: { type?: string; ports?: RawServicePort[] };
  status?: { loadBalancer?: { ingress?: Array<{ ip?: string; hostname?: string }> } };
};

type RawList<T> = { items?: T[] };

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveScheme(port?: RawServicePort): "http" | "https" {
  if (!port) return "http";
  if (port.port === 443) return "https";
  if (port.name?.toLowerCase().includes("https")) return "https";
  return "http";
}

function buildTargets(ingresses: RawIngress[], services: RawService[]): BlackboxProbeItem[] {
  const targets: BlackboxProbeItem[] = [];
  const seen = new Set<string>();

  for (const ingress of ingresses) {
    const hosts =
      ingress.spec?.rules
        ?.map((rule) => rule.host)
        .filter((host): host is string => typeof host === "string" && host.length > 0) ?? [];
    const tlsHosts = new Set(
      ingress.spec?.tls?.flatMap((tls) => tls.hosts ?? []).filter(Boolean) ?? [],
    );
    for (const host of hosts) {
      const scheme = tlsHosts.has(host) ? "https" : "http";
      const target = `${scheme}://${host}`;
      if (seen.has(target)) continue;
      seen.add(target);
      targets.push({
        target,
        source: "ingress",
        namespace: ingress.metadata?.namespace ?? "default",
        name: ingress.metadata?.name ?? "unknown",
        status: "unknown",
      });
    }
  }

  for (const service of services) {
    const spec = service.spec;
    if (!spec || spec.type !== "LoadBalancer") continue;
    const ingressList = service.status?.loadBalancer?.ingress ?? [];
    const port = spec.ports?.[0];
    const scheme = resolveScheme(port);
    for (const entry of ingressList) {
      const host = entry.hostname ?? entry.ip;
      if (!host) continue;
      const portPart = port?.port ? `:${port.port}` : "";
      const target = `${scheme}://${host}${portPart}`;
      if (seen.has(target)) continue;
      seen.add(target);
      targets.push({
        target,
        source: "service",
        namespace: service.metadata?.namespace ?? "default",
        name: service.metadata?.name ?? "unknown",
        status: "unknown",
      });
    }
  }

  return targets.slice(0, MAX_TARGETS);
}

function buildSummary(items: BlackboxProbeItem[], errorMessage?: string) {
  if (errorMessage) {
    return {
      status: "unknown" as BlackboxProbeStatus,
      warnings: [errorMessage],
      message: "Blackbox probe data unavailable.",
    };
  }

  if (!items.length) {
    return {
      status: "unknown" as BlackboxProbeStatus,
      warnings: ["No blackbox targets discovered."],
      message: "No blackbox targets configured.",
    };
  }

  const summary = items.reduce<Record<BlackboxProbeStatus, number>>(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { ok: 0, warning: 0, critical: 0, unknown: 0 },
  );

  let status: BlackboxProbeStatus = "ok";
  if (summary.critical > 0) status = "critical";
  else if (summary.warning > 0) status = "warning";
  else if (summary.unknown > 0 && summary.ok === 0) status = "unknown";

  const message = `Targets: ${summary.ok} ok · ${summary.warning} warning · ${summary.critical} critical`;

  const warnings: string[] = [];
  if (summary.critical > 0) warnings.push("Blackbox probes report critical targets.");
  if (summary.warning > 0) warnings.push("Blackbox probes report warnings.");

  return { status, warnings, message };
}

function parsePromValue(result?: { value?: [number, string] }): number | undefined {
  if (!result?.value?.[1]) return undefined;
  const value = Number(result.value[1]);
  return Number.isFinite(value) ? value : undefined;
}

function applyProbeMetrics(
  items: BlackboxProbeItem[],
  metrics: {
    success: Map<string, { value?: number; module?: string }>;
    duration: Map<string, number>;
    sslExpiry: Map<string, number>;
  },
): BlackboxProbeItem[] {
  const nowSeconds = Date.now() / 1000;

  return items.map((item) => {
    const successEntry = metrics.success.get(item.target);
    const successValue = successEntry?.value;
    const duration = metrics.duration.get(item.target);
    const sslExpiry = metrics.sslExpiry.get(item.target);
    const sslDaysLeft =
      sslExpiry !== undefined ? Math.floor((sslExpiry - nowSeconds) / 86400) : undefined;

    let status: BlackboxProbeStatus = "unknown";
    if (successValue !== undefined) {
      status = successValue === 1 ? "ok" : "critical";
    }

    if (sslDaysLeft !== undefined) {
      if (sslDaysLeft <= TLS_CRITICAL_DAYS) status = "critical";
      else if (sslDaysLeft <= TLS_WARNING_DAYS && status === "ok") status = "warning";
    }

    return {
      ...item,
      module: successEntry?.module,
      durationSeconds: duration,
      sslExpiry,
      sslDaysLeft,
      status,
    };
  });
}

export async function checkBlackboxProbes(
  clusterId: string,
  options?: { force?: boolean },
): Promise<BlackboxProbeReport> {
  const cached = cachedReports.get(clusterId);
  const skippedCapability = !options?.force
    ? getFeatureCapability(clusterId, BLACKBOX_PROBES_FEATURE_ID)
    : null;

  if (
    !options?.force &&
    shouldSkipFeatureProbe(clusterId, BLACKBOX_PROBES_FEATURE_ID, {
      statuses: [
        "unsupported",
        "forbidden",
        "unreachable",
        "unavailable",
        "misconfigured",
        "unknown",
      ],
    })
  ) {
    if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
      return cached.data;
    }

    const reason =
      skippedCapability?.reason ?? "Blackbox probes temporarily paused after repeated failures.";
    const summary = buildSummary([], reason);
    const report: BlackboxProbeReport = {
      status: summary.status,
      summary: { ...summary, updatedAt: Date.now() },
      items: [],
      errors: reason,
      updatedAt: Date.now(),
    };
    cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
    return report;
  }

  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let items: BlackboxProbeItem[] = [];

  try {
    const [ingressRes, serviceRes] = await Promise.all([
      kubectlRawFront(`get ingress --all-namespaces -o json --request-timeout=${REQUEST_TIMEOUT}`, {
        clusterId,
      }),
      kubectlRawFront(`get svc --all-namespaces -o json --request-timeout=${REQUEST_TIMEOUT}`, {
        clusterId,
      }),
    ]);

    const ingressList = parseJson(ingressRes.output) as RawList<RawIngress> | null;
    const serviceList = parseJson(serviceRes.output) as RawList<RawService> | null;

    if (ingressRes.errors || serviceRes.errors) {
      errorMessage = ingressRes.errors || serviceRes.errors || "Failed to fetch targets.";
      await logError(`Blackbox probe target discovery failed: ${errorMessage}`);
    } else {
      items = buildTargets(ingressList?.items ?? [], serviceList?.items ?? []);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch targets.";
    await logError(`Blackbox probe target discovery failed: ${errorMessage}`);
  }

  if (!items.length) {
    const summary = buildSummary(items, errorMessage);
    const report: BlackboxProbeReport = {
      status: summary.status,
      summary: { ...summary, updatedAt: Date.now() },
      items,
      errors: errorMessage,
      updatedAt: Date.now(),
    };
    cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
    return report;
  }

  const promClient = new PrometheusClient(clusterId);
  const instanceFilter = items.map((item) => escapeRegex(item.target)).join("|");

  try {
    const [successResults, durationResults, sslResults] = await Promise.all([
      promClient.queryInstant(`probe_success{instance=~"${instanceFilter}"}`),
      promClient.queryInstant(`probe_duration_seconds{instance=~"${instanceFilter}"}`),
      promClient.queryInstant(`probe_ssl_earliest_cert_expiry{instance=~"${instanceFilter}"}`),
    ]);

    const success = new Map<string, { value?: number; module?: string }>();
    for (const result of successResults) {
      const instance = result.metric.instance;
      if (!instance) continue;
      success.set(instance, {
        value: parsePromValue(result),
        module: result.metric.module,
      });
    }

    const duration = new Map<string, number>();
    for (const result of durationResults) {
      const instance = result.metric.instance;
      if (!instance) continue;
      const value = parsePromValue(result);
      if (value !== undefined) duration.set(instance, value);
    }

    const sslExpiry = new Map<string, number>();
    for (const result of sslResults) {
      const instance = result.metric.instance;
      if (!instance) continue;
      const value = parsePromValue(result);
      if (value !== undefined) sslExpiry.set(instance, value);
    }

    items = applyProbeMetrics(items, { success, duration, sslExpiry });
    markFeatureCapability(clusterId, BLACKBOX_PROBES_FEATURE_ID, {
      status: "available",
    });
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Failed to query blackbox probe metrics.";
    markFeatureCapabilityFromReason(clusterId, BLACKBOX_PROBES_FEATURE_ID, errorMessage);
    if (!isExpectedClusterProbeError(errorMessage)) {
      await logError(`Blackbox probe metrics fetch failed: ${errorMessage}`);
    }
  }

  const summary = buildSummary(items, errorMessage);
  const report: BlackboxProbeReport = {
    status: summary.status,
    summary: { ...summary, updatedAt: Date.now() },
    items,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
