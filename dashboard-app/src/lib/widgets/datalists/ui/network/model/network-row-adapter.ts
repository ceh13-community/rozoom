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

function getSpec(item: GenericItem) {
  return asRecord(item.spec) ?? {};
}

function getStatus(item: GenericItem) {
  return asRecord(item.status) ?? {};
}

function joinDefined(values: string[]) {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.join(", ") : "-";
}

function countServicePorts(spec: Record<string, unknown>) {
  return asArray(spec.ports).length;
}

function summarizeServiceExposure(spec: Record<string, unknown>, status: Record<string, unknown>) {
  const clusterIp = asString(spec.clusterIP, "");
  const type = asString(spec.type, "ClusterIP");
  const ingress = asArray(asRecord(status.loadBalancer)?.ingress)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => asString(entry.ip, asString(entry.hostname, "")))
    .filter((value) => value !== "");
  const externalIps = asArray(spec.externalIPs)
    .map((entry) => asString(entry, ""))
    .filter((value) => value !== "");
  return joinDefined([
    type,
    clusterIp ? `cluster ${clusterIp}` : "",
    ingress.length > 0 ? `lb ${ingress.join(", ")}` : "",
    externalIps.length > 0 ? `ext ${externalIps.join(", ")}` : "",
  ]);
}

function summarizeEndpoints(subsetsValue: unknown) {
  const subsets = asArray(subsetsValue);
  let addresses = 0;
  let ports = 0;
  for (const subset of subsets) {
    const record = asRecord(subset);
    if (!record) continue;
    addresses += asArray(record.addresses).length;
    ports += asArray(record.ports).length;
  }
  return joinDefined([
    addresses > 0 ? `${addresses} addresses` : "",
    ports > 0 ? `${ports} ports` : "",
  ]);
}

function summarizeIngress(spec: Record<string, unknown>, status: Record<string, unknown>) {
  const rules = asArray(spec.rules);
  const hosts = rules
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => asString(entry.host, ""))
    .filter((value) => value !== "");
  const balancers = asArray(asRecord(status.loadBalancer)?.ingress)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => asString(entry.ip, asString(entry.hostname, "")))
    .filter((value) => value !== "");
  return joinDefined([
    hosts.length > 0 ? `${hosts.length} hosts` : "",
    balancers.length > 0 ? `lb ${balancers.join(", ")}` : "",
  ]);
}

function summarizeGateway(spec: Record<string, unknown>, status: Record<string, unknown>) {
  const gatewayClassName = asString(spec.gatewayClassName, "");
  const listeners = asArray(spec.listeners).length;
  const addresses = asArray(status.addresses)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => asString(entry.value, ""))
    .filter((value) => value !== "");
  return joinDefined([
    gatewayClassName ? `class ${gatewayClassName}` : "",
    listeners > 0 ? `${listeners} listeners` : "",
    addresses.length > 0 ? addresses.join(", ") : "",
  ]);
}

function summarizeHttpRoute(spec: Record<string, unknown>) {
  const hostnames = asArray(spec.hostnames).filter((value) => typeof value === "string").length;
  const parentRefs = asArray(spec.parentRefs).length;
  const rules = asArray(spec.rules).length;
  return joinDefined([
    hostnames > 0 ? `${hostnames} hostnames` : "",
    parentRefs > 0 ? `${parentRefs} parents` : "",
    rules > 0 ? `${rules} rules` : "",
  ]);
}

function summarizeReferenceGrant(spec: Record<string, unknown>) {
  const fromCount = asArray(spec.from).length;
  const toCount = asArray(spec.to).length;
  return joinDefined([
    fromCount > 0 ? `${fromCount} from` : "",
    toCount > 0 ? `${toCount} to` : "",
  ]);
}

function summarizeNetworkPolicy(spec: Record<string, unknown>) {
  const selector = asRecord(spec.podSelector);
  const labels = asRecord(selector?.matchLabels);
  const selectorCount = labels ? Object.keys(labels).length : 0;
  const policyTypes = asArray(spec.policyTypes).filter((value) => typeof value === "string");
  return joinDefined([
    selectorCount > 0 ? `${selectorCount} selector labels` : "all pods",
    policyTypes.length > 0 ? policyTypes.join("/") : "",
  ]);
}

function summarizeIngressClass(spec: Record<string, unknown>) {
  return asString(spec.controller);
}

function summarizeGatewayClass(spec: Record<string, unknown>) {
  return asString(spec.controllerName);
}

function resolveSubtype(workloadKey: string, spec: Record<string, unknown>) {
  switch (workloadKey) {
    case "services":
      return asString(spec.type, "Service");
    case "ingresses":
      return asString(spec.ingressClassName, "Ingress");
    case "ingressclasses":
      return "IngressClass";
    case "gatewayclasses":
      return "GatewayClass";
    case "gateways":
      return "Gateway";
    case "httproutes":
      return "HTTPRoute";
    case "referencegrants":
      return "ReferenceGrant";
    case "networkpolicies":
      return "NetworkPolicy";
    case "endpoints":
      return "Endpoints";
    default:
      return workloadKey;
  }
}

export function getNetworkItemUid(item: GenericItem) {
  const metadata = getMetadata(item);
  return asString(
    metadata.uid,
    `${asString(metadata.namespace, "cluster")}/${asString(metadata.name, "unknown")}`,
  );
}

export function adaptNetworkRow(item: GenericItem, workloadKey: string) {
  const metadata = getMetadata(item);
  const spec = getSpec(item);
  const status = getStatus(item);
  const createdAt = asString(metadata.creationTimestamp, "");

  let summary = "-";
  let ports = "-";

  switch (workloadKey) {
    case "services":
      summary = summarizeServiceExposure(spec, status);
      ports = String(countServicePorts(spec));
      break;
    case "endpoints":
      summary = summarizeEndpoints(item.subsets);
      break;
    case "ingresses":
      summary = summarizeIngress(spec, status);
      ports = String(asArray(spec.rules).length);
      break;
    case "ingressclasses":
      summary = summarizeIngressClass(spec);
      break;
    case "gatewayclasses":
      summary = summarizeGatewayClass(spec);
      break;
    case "gateways":
      summary = summarizeGateway(spec, status);
      ports = String(asArray(spec.listeners).length);
      break;
    case "httproutes":
      summary = summarizeHttpRoute(spec);
      ports = String(asArray(spec.rules).length);
      break;
    case "referencegrants":
      summary = summarizeReferenceGrant(spec);
      break;
    case "networkpolicies":
      summary = summarizeNetworkPolicy(spec);
      break;
  }

  return {
    uid: getNetworkItemUid(item),
    name: asString(metadata.name, "unknown"),
    namespace: asString(metadata.namespace, "cluster"),
    subtype: resolveSubtype(workloadKey, spec),
    summary,
    ports,
    age: createdAt ? getTimeDifference(new Date(createdAt)) : "-",
    raw: item,
  };
}
