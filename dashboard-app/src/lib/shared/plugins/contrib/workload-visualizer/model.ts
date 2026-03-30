/* eslint-disable @typescript-eslint/no-unnecessary-condition -- runtime guards for optional K8s resource fields */
/**
 * Workload Visualizer - dependency map model.
 *
 * Builds a directed graph of K8s resource relationships:
 *   Ingress -> Service -> Deployment/StatefulSet/ReplicaSet -> Pod
 *   Pod -> ConfigMap, Secret, PVC, ServiceAccount
 *   ServiceAccount -> Role/ClusterRole (via RoleBinding)
 *   Ingress -> TLS Secret (certificate)
 *
 * Example plugin demonstrating the ROZOOM plugin architecture.
 */

export type NodeKind =
  | "Ingress"
  | "Service"
  | "Deployment"
  | "StatefulSet"
  | "ReplicaSet"
  | "DaemonSet"
  | "Pod"
  | "ConfigMap"
  | "Secret"
  | "PersistentVolumeClaim"
  | "ServiceAccount"
  | "Role"
  | "ClusterRole"
  | "NetworkPolicy"
  | "HPA";

export type GraphNode = {
  id: string;
  kind: NodeKind;
  name: string;
  namespace: string;
  status?: "healthy" | "warning" | "error" | "unknown";
  metadata?: Record<string, string>;
};

export type GraphEdge = {
  source: string;
  target: string;
  label: string;
  type: "routes-to" | "selects" | "mounts" | "uses" | "binds" | "scales" | "secures";
};

export type DependencyGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: {
    totalNodes: number;
    totalEdges: number;
    byKind: Record<string, number>;
    orphanedNodes: number;
    warnings: string[];
  };
};

type GenericItem = {
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
};

function nodeId(kind: string, namespace: string, name: string): string {
  return `${kind}/${namespace}/${name}`;
}

function makeNode(
  kind: NodeKind,
  name: string,
  namespace: string,
  status?: GraphNode["status"],
): GraphNode {
  return { id: nodeId(kind, namespace, name), kind, name, namespace, status };
}

export function buildDependencyGraph(resources: {
  ingresses?: GenericItem[];
  services?: GenericItem[];
  deployments?: GenericItem[];
  statefulsets?: GenericItem[];
  replicasets?: GenericItem[];
  daemonsets?: GenericItem[];
  pods?: GenericItem[];
  configmaps?: GenericItem[];
  secrets?: GenericItem[];
  pvcs?: GenericItem[];
  serviceaccounts?: GenericItem[];
  roles?: GenericItem[];
  clusterroles?: GenericItem[];
  rolebindings?: GenericItem[];
  networkpolicies?: GenericItem[];
  hpas?: GenericItem[];
}): DependencyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  function addNode(node: GraphNode) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }

  function addEdge(source: string, target: string, label: string, type: GraphEdge["type"]) {
    if (nodes.has(source) && nodes.has(target)) {
      edges.push({ source, target, label, type });
    }
  }

  // Register all resources as nodes
  for (const ing of resources.ingresses ?? []) {
    const name = ing.metadata?.name ?? "";
    const ns = ing.metadata?.namespace ?? "default";
    addNode(makeNode("Ingress", name, ns, "healthy"));
  }

  for (const svc of resources.services ?? []) {
    const name = svc.metadata?.name ?? "";
    const ns = svc.metadata?.namespace ?? "default";
    addNode(makeNode("Service", name, ns, "healthy"));
  }

  for (const dep of resources.deployments ?? []) {
    const name = dep.metadata?.name ?? "";
    const ns = dep.metadata?.namespace ?? "default";
    const replicas = (dep.spec as Record<string, unknown>)?.replicas as number | undefined;
    const ready = ((dep.status as Record<string, unknown>)?.readyReplicas as number) ?? 0;
    const status = replicas && ready < replicas ? "warning" : "healthy";
    addNode(makeNode("Deployment", name, ns, status));
  }

  for (const sts of resources.statefulsets ?? []) {
    const name = sts.metadata?.name ?? "";
    const ns = sts.metadata?.namespace ?? "default";
    addNode(makeNode("StatefulSet", name, ns, "healthy"));
  }

  for (const rs of resources.replicasets ?? []) {
    const name = rs.metadata?.name ?? "";
    const ns = rs.metadata?.namespace ?? "default";
    addNode(makeNode("ReplicaSet", name, ns));
  }

  for (const ds of resources.daemonsets ?? []) {
    const name = ds.metadata?.name ?? "";
    const ns = ds.metadata?.namespace ?? "default";
    addNode(makeNode("DaemonSet", name, ns, "healthy"));
  }

  for (const pod of resources.pods ?? []) {
    const name = pod.metadata?.name ?? "";
    const ns = pod.metadata?.namespace ?? "default";
    const phase = (pod.status as Record<string, unknown>)?.phase as string | undefined;
    const status =
      phase === "Running"
        ? "healthy"
        : phase === "Pending"
          ? "warning"
          : phase === "Failed"
            ? "error"
            : "unknown";
    addNode(makeNode("Pod", name, ns, status));
  }

  for (const cm of resources.configmaps ?? []) {
    addNode(makeNode("ConfigMap", cm.metadata?.name ?? "", cm.metadata?.namespace ?? "default"));
  }
  for (const s of resources.secrets ?? []) {
    addNode(makeNode("Secret", s.metadata?.name ?? "", s.metadata?.namespace ?? "default"));
  }
  for (const pvc of resources.pvcs ?? []) {
    addNode(
      makeNode(
        "PersistentVolumeClaim",
        pvc.metadata?.name ?? "",
        pvc.metadata?.namespace ?? "default",
      ),
    );
  }
  for (const sa of resources.serviceaccounts ?? []) {
    addNode(
      makeNode("ServiceAccount", sa.metadata?.name ?? "", sa.metadata?.namespace ?? "default"),
    );
  }
  for (const np of resources.networkpolicies ?? []) {
    addNode(
      makeNode("NetworkPolicy", np.metadata?.name ?? "", np.metadata?.namespace ?? "default"),
    );
  }
  for (const hpa of resources.hpas ?? []) {
    addNode(makeNode("HPA", hpa.metadata?.name ?? "", hpa.metadata?.namespace ?? "default"));
  }

  // Build edges: Ingress -> Service (via rules)
  for (const ing of resources.ingresses ?? []) {
    const ns = ing.metadata?.namespace ?? "default";
    const ingId = nodeId("Ingress", ns, ing.metadata?.name ?? "");
    const rules = (ing.spec as Record<string, unknown>)?.rules as
      | Array<{ http?: { paths?: Array<{ backend?: { service?: { name?: string } } }> } }>
      | undefined;
    for (const rule of rules ?? []) {
      for (const path of rule.http?.paths ?? []) {
        const svcName = path.backend?.service?.name;
        if (svcName) addEdge(ingId, nodeId("Service", ns, svcName), "routes", "routes-to");
      }
    }
    // TLS secrets
    const tls = (ing.spec as Record<string, unknown>)?.tls as
      | Array<{ secretName?: string }>
      | undefined;
    for (const t of tls ?? []) {
      if (t.secretName) addEdge(ingId, nodeId("Secret", ns, t.secretName), "TLS cert", "secures");
    }
  }

  // Service -> Pod (via selector matching, simplified via label match to Deployment)
  for (const svc of resources.services ?? []) {
    const ns = svc.metadata?.namespace ?? "default";
    const svcId = nodeId("Service", ns, svc.metadata?.name ?? "");
    const selector = (svc.spec as Record<string, unknown>)?.selector as
      | Record<string, string>
      | undefined;
    if (!selector) continue;

    // Match deployments/statefulsets by label overlap
    for (const dep of [
      ...(resources.deployments ?? []),
      ...(resources.statefulsets ?? []),
      ...(resources.daemonsets ?? []),
    ]) {
      const depLabels = ((dep.spec as Record<string, unknown>)?.template as Record<string, unknown>)
        ?.metadata as Record<string, unknown>;
      const podLabels = (depLabels?.labels as Record<string, string>) ?? dep.metadata?.labels ?? {};
      const matches = Object.entries(selector).every(([k, v]) => podLabels[k] === v);
      if (matches) {
        const kind = resources.deployments?.includes(dep)
          ? "Deployment"
          : resources.statefulsets?.includes(dep)
            ? "StatefulSet"
            : "DaemonSet";
        addEdge(svcId, nodeId(kind, ns, dep.metadata?.name ?? ""), "selects", "selects");
      }
    }
  }

  // Deployment -> Pod (via ownerReferences)
  for (const pod of resources.pods ?? []) {
    const ns = pod.metadata?.namespace ?? "default";
    const podId = nodeId("Pod", ns, pod.metadata?.name ?? "");
    const owners = (pod.metadata as Record<string, unknown>)?.ownerReferences as
      | Array<{ kind?: string; name?: string }>
      | undefined;
    for (const owner of owners ?? []) {
      if (owner.kind && owner.name) {
        addEdge(nodeId(owner.kind as NodeKind, ns, owner.name), podId, "owns", "selects");
      }
    }
  }

  // Pod -> ConfigMap, Secret, PVC, ServiceAccount (via volumes/envFrom)
  for (const pod of resources.pods ?? []) {
    const ns = pod.metadata?.namespace ?? "default";
    const podId = nodeId("Pod", ns, pod.metadata?.name ?? "");
    const spec = pod.spec;
    const volumes = spec?.volumes as Array<Record<string, unknown>> | undefined;
    for (const vol of volumes ?? []) {
      if (vol.configMap)
        addEdge(
          podId,
          nodeId("ConfigMap", ns, (vol.configMap as Record<string, string>).name),
          "mounts",
          "mounts",
        );
      if (vol.secret)
        addEdge(
          podId,
          nodeId("Secret", ns, (vol.secret as Record<string, string>).secretName),
          "mounts",
          "mounts",
        );
      if (vol.persistentVolumeClaim)
        addEdge(
          podId,
          nodeId(
            "PersistentVolumeClaim",
            ns,
            (vol.persistentVolumeClaim as Record<string, string>).claimName,
          ),
          "mounts",
          "mounts",
        );
    }
    const saName = spec?.serviceAccountName as string | undefined;
    if (saName) addEdge(podId, nodeId("ServiceAccount", ns, saName), "runs as", "uses");
  }

  // HPA -> Deployment/StatefulSet
  for (const hpa of resources.hpas ?? []) {
    const ns = hpa.metadata?.namespace ?? "default";
    const hpaId = nodeId("HPA", ns, hpa.metadata?.name ?? "");
    const target = (hpa.spec as Record<string, unknown>)?.scaleTargetRef as
      | Record<string, string>
      | undefined;
    if (target?.kind && target?.name) {
      addEdge(hpaId, nodeId(target.kind as NodeKind, ns, target.name), "scales", "scales");
    }
  }

  // Summary
  const allNodes = Array.from(nodes.values());
  const connectedIds = new Set(edges.flatMap((e) => [e.source, e.target]));
  const orphaned = allNodes.filter((n) => !connectedIds.has(n.id));

  const byKind: Record<string, number> = {};
  for (const n of allNodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;

  if (orphaned.length > 0) warnings.push(`${orphaned.length} resources have no connections`);

  return {
    nodes: allNodes,
    edges,
    summary: {
      totalNodes: allNodes.length,
      totalEdges: edges.length,
      byKind,
      orphanedNodes: orphaned.length,
      warnings,
    },
  };
}
