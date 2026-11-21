// What a port-forward can target and which remote ports it offers. One shape for Services
// and Pods, so both open the same dialog and the same panel.

export type PortForwardScheme = "http" | "https";

export type PortForwardPortOption = {
  port: number;
  /** Port name, or "" when the spec has none. */
  name: string;
  /** Container that declares the port (pods only). */
  container?: string;
  scheme: PortForwardScheme;
};

export type PortForwardTarget = {
  kind: "service" | "pod";
  namespace: string;
  name: string;
  /** TCP ports from the spec, the preferred one first. May be empty: the user types a port. */
  ports: PortForwardPortOption[];
};

type GenericItem = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function schemeForPort(port: number, name = "", appProtocol = ""): PortForwardScheme {
  const hint = `${name} ${appProtocol}`.toLowerCase();
  return hint.includes("https") || port === 443 || port === 8443 ? "https" : "http";
}

function isMetricsPort(name: string) {
  const lower = name.toLowerCase();
  return lower.includes("metrics") || lower.includes("prometheus");
}

/** Web ports first, metrics ports last; otherwise the spec order. */
function preferWebPorts(options: PortForwardPortOption[]) {
  return [
    ...options.filter((option) => !isMetricsPort(option.name)),
    ...options.filter((option) => isMetricsPort(option.name)),
  ];
}

function isTcp(entry: Record<string, unknown>) {
  return (asString(entry.protocol) || "TCP").toUpperCase() === "TCP";
}

function isValidPort(port: number) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function servicePortForwardTarget(item: GenericItem): PortForwardTarget {
  const metadata = asRecord(item.metadata) ?? {};
  const spec = asRecord(item.spec) ?? {};
  const ports = asArray(spec.ports)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null && isTcp(entry))
    .map((entry) => {
      const port = Number(entry.port ?? 0);
      const name = asString(entry.name);
      return { port, name, scheme: schemeForPort(port, name, asString(entry.appProtocol)) };
    })
    .filter((option) => isValidPort(option.port));
  return {
    kind: "service",
    namespace: asString(metadata.namespace) || "default",
    name: asString(metadata.name) || "unknown",
    ports: preferWebPorts(ports),
  };
}

export function podPortForwardTarget(pod: GenericItem): PortForwardTarget {
  const metadata = asRecord(pod.metadata) ?? {};
  const spec = asRecord(pod.spec) ?? {};
  const seen = new Set<number>();
  const ports: PortForwardPortOption[] = [];
  for (const container of asArray(spec.containers).map(asRecord)) {
    if (!container) continue;
    for (const entry of asArray(container.ports).map(asRecord)) {
      if (!entry || !isTcp(entry)) continue;
      const port = Number(entry.containerPort ?? 0);
      if (!isValidPort(port) || seen.has(port)) continue;
      seen.add(port);
      const name = asString(entry.name);
      ports.push({
        port,
        name,
        container: asString(container.name),
        scheme: schemeForPort(port, name),
      });
    }
  }
  return {
    kind: "pod",
    namespace: asString(metadata.namespace) || "default",
    name: asString(metadata.name) || "unknown",
    ports: preferWebPorts(ports),
  };
}

export function portForwardResource(target: PortForwardTarget) {
  return `${target.kind === "service" ? "svc" : "pod"}/${target.name}`;
}

/** Same key format as Network > Port Forwarding, so a forward shows there and can be stopped. */
export function portForwardKey(
  clusterId: string,
  target: PortForwardTarget,
  localPort: number,
  remotePort: number,
) {
  return `${clusterId}:${target.namespace}:${portForwardResource(target)}:${localPort}:${remotePort}`;
}

export function parsePortInput(raw: string | number | null | undefined): number | null {
  const trimmed = String(raw ?? "").trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  return isValidPort(port) ? port : null;
}
