import type { YamlBackupMetadata } from "./types";

export function sanitizeClusterName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  return sanitized || "unknown-cluster";
}

export function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function buildBackupDirPath(clusterName: string, timestamp: Date): string {
  const safe = sanitizeClusterName(clusterName);
  const ts = formatTimestamp(timestamp);
  return `rozoom/backup/${safe}/${ts}`;
}

export function buildResourceFilename(resourceType: string, namespace: string | null): string {
  const prefix = namespace ?? "_cluster";
  return `${prefix}--${resourceType}.yaml`;
}

export function buildMetadataFilename(): string {
  return "_metadata.json";
}

export function parseBackupTimestamp(dirName: string): Date | null {
  const restored = dirName.replace(/-/g, (match, offset: number) => {
    if (offset === 4 || offset === 7) return "-";
    if (offset === 13 || offset === 16) return ":";
    if (offset === 10) return "T";
    return match;
  });
  const date = new Date(restored + "Z");
  return Number.isFinite(date.getTime()) ? date : null;
}

export function parseMetadataFile(json: string): YamlBackupMetadata | null {
  try {
    const parsed = JSON.parse(json) as Partial<YamlBackupMetadata>;
    if (parsed.version !== 1) return null;
    if (typeof parsed.timestamp !== "string") return null;
    if (typeof parsed.clusterName !== "string") return null;
    if (typeof parsed.clusterId !== "string") return null;
    if (!Array.isArray(parsed.files)) return null;
    if (!Array.isArray(parsed.namespaces)) return null;
    return parsed as YamlBackupMetadata;
  } catch {
    return null;
  }
}

export function countYamlDocuments(yaml: string): number {
  if (!yaml.trim()) return 0;
  const items = yaml.match(/^kind:\s/gm);
  return items ? items.length : 0;
}
