export type ResourceRef = {
  kind: string;
  name: string;
  namespace?: string;
};

export type ResourceRelationGraph = {
  root: ResourceRef;
  related: ResourceRef[];
};

export function buildResourceRelationGraph(input: {
  root: ResourceRef;
  ownerReferences?: Array<{ kind?: string; name?: string }>;
  podRefs?: Array<{ name?: string; namespace?: string }>;
}): ResourceRelationGraph {
  const related: ResourceRef[] = [];
  for (const owner of input.ownerReferences ?? []) {
    if (!owner.kind || !owner.name) continue;
    related.push({
      kind: owner.kind,
      name: owner.name,
      namespace: input.root.namespace,
    });
  }
  for (const pod of input.podRefs ?? []) {
    if (!pod.name) continue;
    related.push({
      kind: "Pod",
      name: pod.name,
      namespace: pod.namespace ?? input.root.namespace,
    });
  }
  return { root: input.root, related };
}
