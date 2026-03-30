import { getTimeDifference } from "$shared";

type GenericItem = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function getMetadata(item: GenericItem) {
  return asRecord(item.metadata) ?? {};
}

function getExposureSignal(type: string) {
  switch (type) {
    case "kubernetes.io/service-account-token":
      return "Service account token";
    case "kubernetes.io/dockerconfigjson":
    case "kubernetes.io/dockercfg":
      return "Registry credentials";
    case "kubernetes.io/tls":
      return "TLS material";
    default:
      return "Opaque metadata only";
  }
}

export function adaptSecretRow(item: GenericItem) {
  const metadata = getMetadata(item);
  const createdAt = asString(metadata.creationTimestamp, "");
  const labels = asRecord(metadata.labels) ?? {};
  const dataMap = asRecord(item.data) ?? {};
  const stringDataMap = asRecord(item.stringData) ?? {};
  const secretType = asString(item.type, "Opaque");
  const keyCount = Object.keys(dataMap).length + Object.keys(stringDataMap).length;

  return {
    uid: asString(
      metadata.uid,
      `${asString(metadata.namespace, "cluster")}/${asString(metadata.name, "unknown")}`,
    ),
    name: asString(metadata.name, "unknown"),
    namespace: asString(metadata.namespace, "cluster"),
    type: secretType,
    keys: keyCount,
    labels: Object.keys(labels).length,
    signal: getExposureSignal(secretType),
    references: asArray(item.ownerReferences).length,
    age: createdAt ? getTimeDifference(new Date(createdAt)) : "-",
    raw: item,
  };
}

export type SecretRow = ReturnType<typeof adaptSecretRow>;
