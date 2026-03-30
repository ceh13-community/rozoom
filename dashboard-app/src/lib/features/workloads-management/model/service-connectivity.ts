/**
 * Service Connectivity Map (#16)
 *
 * Maps Service → EndpointSlice → Pod topology.
 */

type GenericItem = Record<string, unknown>;

export type ServiceNode = {
  kind: "Service" | "EndpointSlice" | "Pod";
  name: string;
  namespace: string;
  status: "healthy" | "degraded" | "unhealthy";
};
export type ServiceEdge = { from: string; to: string; label: string };
export type ServiceTopology = {
  nodes: ServiceNode[];
  edges: ServiceEdge[];
  services: number;
  endpoints: number;
  pods: number;
  healthyPercent: number;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asString(v: unknown, f = ""): string {
  return typeof v === "string" ? v : f;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function buildServiceTopology(input: {
  services: GenericItem[];
  endpointSlices: GenericItem[];
  pods: GenericItem[];
}): ServiceTopology {
  const nodes: ServiceNode[] = [];
  const edges: ServiceEdge[] = [];
  const podStatusMap = new Map<string, string>();

  for (const pod of input.pods) {
    const m = asRecord(pod.metadata);
    const phase = asString(asRecord(pod.status).phase, "Unknown");
    podStatusMap.set(`${asString(m.namespace)}/${asString(m.name)}`, phase);
  }

  for (const svc of input.services) {
    const m = asRecord(svc.metadata);
    const name = asString(m.name);
    const ns = asString(m.namespace);
    const svcId = `svc:${ns}/${name}`;
    nodes.push({ kind: "Service", name, namespace: ns, status: "healthy" });

    // Find matching EndpointSlices
    for (const eps of input.endpointSlices) {
      const em = asRecord(eps.metadata);
      const labels = asRecord(em.labels);
      if (asString(labels["kubernetes.io/service-name"]) !== name) continue;
      if (asString(em.namespace) !== ns) continue;

      const epsName = asString(em.name);
      const epsId = `eps:${ns}/${epsName}`;
      const endpoints = asArray(asRecord(eps).endpoints);
      const readyCount = endpoints.filter(
        (e) => asRecord(asRecord(e).conditions).ready !== false,
      ).length;
      nodes.push({
        kind: "EndpointSlice",
        name: epsName,
        namespace: ns,
        status:
          readyCount === endpoints.length ? "healthy" : readyCount > 0 ? "degraded" : "unhealthy",
      });
      edges.push({ from: svcId, to: epsId, label: `${readyCount}/${endpoints.length} ready` });

      for (const ep of endpoints) {
        const target = asRecord(asRecord(ep).targetRef);
        const podName = asString(target.name);
        if (!podName) continue;
        const podId = `pod:${ns}/${podName}`;
        const phase = podStatusMap.get(`${ns}/${podName}`) ?? "Unknown";
        if (!nodes.some((n) => n.kind === "Pod" && n.name === podName && n.namespace === ns)) {
          nodes.push({
            kind: "Pod",
            name: podName,
            namespace: ns,
            status: phase === "Running" ? "healthy" : "unhealthy",
          });
        }
        edges.push({ from: epsId, to: podId, label: phase });
      }
    }
  }

  const svcCount = nodes.filter((n) => n.kind === "Service").length;
  const epsCount = nodes.filter((n) => n.kind === "EndpointSlice").length;
  const podCount = nodes.filter((n) => n.kind === "Pod").length;
  const healthyPods = nodes.filter((n) => n.kind === "Pod" && n.status === "healthy").length;

  return {
    nodes,
    edges,
    services: svcCount,
    endpoints: epsCount,
    pods: podCount,
    healthyPercent: podCount > 0 ? Math.round((healthyPods / podCount) * 100) : 100,
  };
}
