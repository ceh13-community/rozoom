type GenericItem = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function getRandomLocalPort() {
  return Math.floor(Math.random() * (60999 - 30000 + 1)) + 30000;
}

export function resolveServicePortForwardTarget(item: GenericItem) {
  const spec = asRecord(item.spec) ?? {};
  const ports = asArray(spec.ports)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      number: Number(entry.port ?? 0),
      name: asString(entry.name).toLowerCase(),
      appProtocol: asString(entry.appProtocol).toLowerCase(),
      protocol: asString(entry.protocol, "TCP").toUpperCase(),
    }))
    .filter(
      (entry) => Number.isFinite(entry.number) && entry.number > 0 && entry.protocol === "TCP",
    );

  const nonMetrics = ports.filter(
    (entry) => !entry.name.includes("metrics") && !entry.name.includes("prometheus"),
  );
  const best = (nonMetrics.length > 0 ? nonMetrics : ports).at(0);

  if (best === undefined) {
    return {
      remotePort: 80,
      scheme: "http" as const,
    };
  }

  return {
    remotePort: best.number,
    scheme:
      best.name.includes("https") ||
      best.appProtocol.includes("https") ||
      best.number === 443 ||
      best.number === 8443
        ? ("https" as const)
        : ("http" as const),
  };
}

export function requestLocalPort(remotePort: number) {
  if (typeof window === "undefined") return getRandomLocalPort();
  const suggested = getRandomLocalPort();
  const raw = window.prompt(
    `Remote port: ${remotePort}\nEnter local port (1-65535):`,
    String(suggested),
  );
  if (raw === null) return null;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }
  return parsed;
}
