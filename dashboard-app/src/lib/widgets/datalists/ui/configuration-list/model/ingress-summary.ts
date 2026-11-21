// What `kubectl get ingress` shows (CLASS, HOSTS, ADDRESS, PORTS) plus the address to
// open and the rules, read from an Ingress object.

type GenericRecord = Record<string, unknown>;

function asRecord(value: unknown): GenericRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as GenericRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type IngressRuleRow = {
  /** Host of the rule, `*` when the rule matches any host. */
  host: string;
  path: string;
  service: string;
  /** Service port number or name; "" when the backend is not a Service. */
  port: string;
};

export type IngressSummary = {
  className: string;
  hosts: string[];
  address: string;
  ports: string;
  /** First reachable address, http or https by TLS; null when the Ingress has none. */
  url: string | null;
  rules: IngressRuleRow[];
};

function backendOf(backend: unknown): { service: string; port: string } {
  const service = asRecord(asRecord(backend).service);
  const port = asRecord(service.port);
  const number = port.number;
  return {
    service: asString(service.name),
    port: typeof number === "number" ? String(number) : asString(port.name),
  };
}

/** An IPv6 load balancer address goes in brackets in a URL. */
function urlHost(address: string) {
  return address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
}

/** A regex path (ImplementationSpecific, `/api(/|$)(.*)`) cannot be opened as written: "/". */
function openablePath(path: string) {
  if (/[()[\]{}*+?^$|\\]/.test(path)) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

export function summarizeIngress(item: GenericRecord): IngressSummary {
  const metadata = asRecord(item.metadata);
  const spec = asRecord(item.spec);
  const status = asRecord(item.status);
  const annotations = asRecord(metadata.annotations);
  const className =
    asString(spec.ingressClassName) || asString(annotations["kubernetes.io/ingress.class"]) || "-";

  const rules: IngressRuleRow[] = [];
  const hosts: string[] = [];
  for (const rawRule of asArray(spec.rules)) {
    const rule = asRecord(rawRule);
    const host = asString(rule.host) || "*";
    if (!hosts.includes(host)) hosts.push(host);
    for (const rawPath of asArray(asRecord(rule.http).paths)) {
      const path = asRecord(rawPath);
      rules.push({ host, path: asString(path.path) || "/", ...backendOf(path.backend) });
    }
  }
  if (spec.defaultBackend) {
    rules.push({ host: "*", path: "(default)", ...backendOf(spec.defaultBackend) });
  }

  const addresses = asArray(asRecord(status.loadBalancer).ingress)
    .map((entry) => asString(asRecord(entry).ip) || asString(asRecord(entry).hostname))
    .filter(Boolean);
  const tls = asArray(spec.tls).map(asRecord);
  const tlsHosts = new Set(tls.flatMap((entry) => asArray(entry.hosts).map(asString)));
  // A TLS entry without hosts covers every host of the Ingress.
  const tlsForAllHosts = tls.some((entry) => asArray(entry.hosts).length === 0);

  // kubectl prints "80" and adds "443" when the Ingress has a TLS section.
  const ports = tls.length > 0 ? "80, 443" : "80";

  // The first host that can be opened: not `*` and not a wildcard like `*.example.com`.
  const first = rules.find((rule) => !rule.host.startsWith("*") && rule.path !== "(default)");
  const fallback: IngressRuleRow | undefined =
    rules.find((rule) => rule.path !== "(default)") ?? rules.at(0);
  let url: string | null = null;
  if (first) {
    const scheme = tlsForAllHosts || tlsHosts.has(first.host) ? "https" : "http";
    url = `${scheme}://${first.host}${openablePath(first.path)}`;
  } else if (addresses[0]) {
    const path = fallback && fallback.path !== "(default)" ? openablePath(fallback.path) : "/";
    url = `${tls.length > 0 ? "https" : "http"}://${urlHost(addresses[0])}${path}`;
  }

  return {
    className,
    hosts: hosts.length > 0 ? hosts : ["*"],
    address: addresses.join(", ") || "-",
    ports,
    url,
    rules,
  };
}
