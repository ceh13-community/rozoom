import { error as logError } from "@tauri-apps/plugin-log";
import type { ClusterData, ConfigMapItem } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import type {
  SecretsHygieneItem,
  SecretsHygieneReport,
  SecretsHygieneStatus,
  SecretsHygieneSummary,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: SecretsHygieneReport; fetchedAt: number }>();

const SUSPICIOUS_KEY_PATTERNS = [
  /pass(word)?/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /access[_-]?key/i,
  /private[_-]?key/i,
  /ssh/i,
  /cert/i,
  /jwt/i,
];

const PEM_HEADER_REGEX = /-----BEGIN [A-Z ]+PRIVATE KEY-----/;
const SSH_KEY_REGEX = /ssh-(rsa|ed25519)/i;
const JWT_REGEX = /eyJ[A-Za-z0-9_-]+?\.[A-Za-z0-9_-]+?\./;
const BASE64_REGEX = /^[A-Za-z0-9+/=]+$/;

const CONFIGMAP_ANTIPATTERN = `apiVersion: v1
kind: ConfigMap
data:
  DB_PASSWORD: supersecret`;

const SECRET_TEMPLATE = `apiVersion: v1
kind: Secret
type: Opaque
stringData:
  DB_PASSWORD: supersecret`;

const SECRET_VOLUME_TEMPLATE = `volumeMounts:
  - name: secrets
    mountPath: /run/secrets
    readOnly: true`;

function normalizeNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : "default";
}

function resolveErrorStatus(message?: string): SecretsHygieneStatus {
  if (!message) return "unknown";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized") ||
    normalized.includes("permission")
  ) {
    return "insufficient";
  }
  if (
    normalized.includes("connection") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("unreachable") ||
    normalized.includes("refused")
  ) {
    return "unreachable";
  }
  return "unknown";
}

function isBase64Like(value: string): boolean {
  if (value.length < 40) return false;
  if (!BASE64_REGEX.test(value)) return false;
  return value.replace(/=+$/, "").length % 4 === 0;
}

function classifyValue(value: string): { status: SecretsHygieneStatus; reason: string } | null {
  if (PEM_HEADER_REGEX.test(value)) {
    return { status: "critical", reason: "Value contains a private key header." };
  }
  if (SSH_KEY_REGEX.test(value)) {
    return { status: "critical", reason: "Value contains an SSH key." };
  }
  if (JWT_REGEX.test(value)) {
    return { status: "critical", reason: "Value resembles a JWT token." };
  }
  if (isBase64Like(value)) {
    return { status: "warning", reason: "Value looks like base64-encoded data." };
  }
  if (value.length > 64 && !value.includes(" ")) {
    return { status: "warning", reason: "Value looks like a long secret string." };
  }
  return null;
}

function buildSummary(
  items: SecretsHygieneItem[],
  errorStatus?: SecretsHygieneStatus,
  encryptionStatus?: SecretsHygieneReport["encryptionStatus"],
): SecretsHygieneSummary {
  const totals = items.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "ok") acc.ok += 1;
      if (item.status === "warning") acc.warning += 1;
      if (item.status === "critical") acc.critical += 1;
      return acc;
    },
    { total: 0, ok: 0, warning: 0, critical: 0 },
  );

  let status: SecretsHygieneStatus = "ok";
  if (errorStatus) {
    status = errorStatus;
  } else if (totals.critical > 0) {
    status = "critical";
  } else if (totals.warning > 0) {
    status = "warning";
  }

  let message = "OK";
  if (status === "warning") {
    message = `Warning (${totals.warning})`;
  } else if (status === "critical") {
    message = `Critical (${totals.critical})`;
  } else if (status === "unreachable") {
    message = "Unreachable";
  } else if (status === "insufficient") {
    message = "Insufficient permissions";
  } else if (status === "unknown") {
    message = "Unknown";
  }

  if (encryptionStatus === "unknown") {
    message = `${message} · Encryption at rest: unknown`;
  } else if (encryptionStatus === "disabled") {
    message = `${message} · Encryption at rest: disabled`;
  }

  return { status, message, ...totals, updatedAt: Date.now() };
}

function evaluateConfigMap(configMap: ConfigMapItem): SecretsHygieneItem[] {
  const items: SecretsHygieneItem[] = [];
  const namespace = normalizeNamespace(configMap.metadata.namespace);
  const dataEntries = Object.entries(configMap.data ?? {});
  const binaryEntries = Object.entries(configMap.binaryData ?? {});

  const checkEntry = (key: string, value: string | undefined) => {
    const issues: string[] = [];
    let status: SecretsHygieneStatus = "ok";

    if (SUSPICIOUS_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      issues.push(`Key name "${key}" looks like a secret.`);
      status = "warning";
    }

    if (value) {
      const valueResult = classifyValue(value);
      if (valueResult) {
        issues.push(valueResult.reason);
        status = valueResult.status;
      }
    }

    if (issues.length === 0) return;

    items.push({
      namespace,
      configMap: configMap.metadata.name,
      key,
      status,
      issues,
      recommendations: [CONFIGMAP_ANTIPATTERN, SECRET_TEMPLATE, SECRET_VOLUME_TEMPLATE],
    });
  };

  dataEntries.forEach(([key, value]) => {
    checkEntry(key, value);
  });
  binaryEntries.forEach(([key]) => {
    checkEntry(key, undefined);
  });

  return items;
}

export async function checkSecretsHygiene(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData },
): Promise<SecretsHygieneReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let data: ClusterData | null = null;

  try {
    data = options?.data ?? (await loadClusterEntities({ uuid: clusterId }, ["configmaps"]));

    if (data.status !== "ok") {
      errorMessage = data.errors ?? "Failed to load configmaps.";
      await logError(`Secrets hygiene check failed: ${errorMessage}`);
      data = null;
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to load configmaps.";
    await logError(`Secrets hygiene check failed: ${errorMessage}`);
    data = null;
  }

  const items: SecretsHygieneItem[] = [];

  if (data) {
    data.configmaps.items.forEach((configMap) => {
      items.push(...evaluateConfigMap(configMap));
    });
  }

  const encryptionStatus: SecretsHygieneReport["encryptionStatus"] = "unknown";
  const errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  const summary = buildSummary(items, errorStatus, encryptionStatus);

  const report: SecretsHygieneReport = {
    status: summary.status,
    summary,
    items,
    encryptionStatus,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
