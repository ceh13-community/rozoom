/**
 * Secret Rotation Audit
 *
 * Identifies secrets that may need rotation based on age thresholds.
 * Highlights stale secrets (>90 days), aging secrets (>30 days),
 * and provides a summary for the security posture score.
 */

type GenericItem = Record<string, unknown>;

export type SecretAgeCategory = "fresh" | "aging" | "stale" | "critical";

export type SecretAuditEntry = {
  name: string;
  namespace: string;
  type: string;
  ageMs: number;
  ageDays: number;
  ageLabel: string;
  category: SecretAgeCategory;
  keys: number;
  lastModified: string;
};

export type SecretRotationReport = {
  entries: SecretAuditEntry[];
  totalSecrets: number;
  fresh: number;
  aging: number;
  stale: number;
  critical: number;
  rotationScore: number;
  oldestAgeDays: number;
  medianAgeDays: number;
};

const AGING_THRESHOLD_DAYS = 30;
const STALE_THRESHOLD_DAYS = 90;
const CRITICAL_THRESHOLD_DAYS = 365;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function categorize(ageDays: number): SecretAgeCategory {
  if (ageDays >= CRITICAL_THRESHOLD_DAYS) return "critical";
  if (ageDays >= STALE_THRESHOLD_DAYS) return "stale";
  if (ageDays >= AGING_THRESHOLD_DAYS) return "aging";
  return "fresh";
}

function formatAge(days: number): string {
  if (days < 1) return "<1d";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

const SYSTEM_SECRET_TYPES = new Set([
  "kubernetes.io/service-account-token",
  "kubernetes.io/dockercfg",
  "kubernetes.io/dockerconfigjson",
  "bootstrap.kubernetes.io/token",
  "kubernetes.io/tls",
]);

export function auditSecretRotation(
  secrets: GenericItem[],
  options: { includeSystemSecrets?: boolean; now?: number } = {},
): SecretRotationReport {
  const now = options.now ?? Date.now();
  const entries: SecretAuditEntry[] = [];

  for (const secret of secrets) {
    const metadata = asRecord(secret.metadata);
    const name = asString(metadata.name);
    const namespace = asString(metadata.namespace);
    const type = asString(secret.type, "Opaque");

    if (!options.includeSystemSecrets && SYSTEM_SECRET_TYPES.has(type)) continue;
    // Skip system-managed secrets
    if (name.startsWith("default-token-")) continue;
    if (name.startsWith("sh.helm.release.")) continue;

    const createdAt = asString(metadata.creationTimestamp);
    const ageMs = createdAt ? now - new Date(createdAt).getTime() : 0;
    const ageDays = Math.floor(ageMs / 86400000);
    const keys = Object.keys(asRecord(secret.data)).length;

    entries.push({
      name,
      namespace,
      type,
      ageMs,
      ageDays,
      ageLabel: formatAge(ageDays),
      category: categorize(ageDays),
      keys,
      lastModified: createdAt,
    });
  }

  entries.sort((a, b) => b.ageDays - a.ageDays);

  const fresh = entries.filter((e) => e.category === "fresh").length;
  const aging = entries.filter((e) => e.category === "aging").length;
  const stale = entries.filter((e) => e.category === "stale").length;
  const critical = entries.filter((e) => e.category === "critical").length;

  const ages = entries.map((e) => e.ageDays).sort((a, b) => a - b);
  const medianAgeDays = ages.length > 0 ? ages[Math.floor(ages.length / 2)] : 0;
  const oldestAgeDays = ages.length > 0 ? ages[ages.length - 1] : 0;

  // Score: 100 = all fresh, 0 = all critical
  const total = entries.length || 1;
  const rotationScore = Math.round((fresh * 100 + aging * 60 + stale * 20 + critical * 0) / total);

  return {
    entries,
    totalSecrets: secrets.length,
    fresh,
    aging,
    stale,
    critical,
    rotationScore: Math.min(100, Math.max(0, rotationScore)),
    oldestAgeDays,
    medianAgeDays,
  };
}
