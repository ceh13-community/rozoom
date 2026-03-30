/**
 * ConfigMap/Secret Dependency Graph
 *
 * Answers: "Which pods/deployments use this configmap/secret?"
 * Scans pod specs for volume mounts, envFrom, and env valueFrom references.
 */

type GenericItem = Record<string, unknown>;

type DependencyConsumer = {
  kind: string;
  name: string;
  namespace: string;
  refType: "volume" | "envFrom" | "env" | "projected";
};

export type DependencyGraphResult = {
  resourceKind: "ConfigMap" | "Secret";
  resourceName: string;
  resourceNamespace: string;
  consumers: DependencyConsumer[];
  orphan: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function extractConfigMapRefsFromPodSpec(
  spec: Record<string, unknown>,
): { name: string; refType: DependencyConsumer["refType"] }[] {
  const refs: { name: string; refType: DependencyConsumer["refType"] }[] = [];

  // Volumes: configMap.name
  for (const volume of asArray(spec.volumes)) {
    const vol = asRecord(volume);
    const cm = asRecord(vol.configMap);
    const name = asString(cm.name);
    if (name) refs.push({ name, refType: "volume" });

    // Projected volumes
    for (const source of asArray(asRecord(vol.projected).sources)) {
      const src = asRecord(source);
      const projCm = asString(asRecord(src.configMap).name);
      if (projCm) refs.push({ name: projCm, refType: "projected" });
    }
  }

  // Containers: envFrom + env valueFrom
  for (const container of [...asArray(spec.containers), ...asArray(spec.initContainers)]) {
    const c = asRecord(container);
    for (const envFrom of asArray(c.envFrom)) {
      const ref = asRecord(envFrom);
      const name = asString(asRecord(ref.configMapRef).name);
      if (name) refs.push({ name, refType: "envFrom" });
    }
    for (const env of asArray(c.env)) {
      const e = asRecord(env);
      const vf = asRecord(e.valueFrom);
      const name = asString(asRecord(vf.configMapKeyRef).name);
      if (name) refs.push({ name, refType: "env" });
    }
  }

  return refs;
}

function extractSecretRefsFromPodSpec(
  spec: Record<string, unknown>,
): { name: string; refType: DependencyConsumer["refType"] }[] {
  const refs: { name: string; refType: DependencyConsumer["refType"] }[] = [];

  for (const volume of asArray(spec.volumes)) {
    const vol = asRecord(volume);
    const sec = asRecord(vol.secret);
    const name = asString(sec.secretName);
    if (name) refs.push({ name, refType: "volume" });

    for (const source of asArray(asRecord(vol.projected).sources)) {
      const src = asRecord(source);
      const projSec = asString(asRecord(src.secret).name);
      if (projSec) refs.push({ name: projSec, refType: "projected" });
    }
  }

  for (const container of [...asArray(spec.containers), ...asArray(spec.initContainers)]) {
    const c = asRecord(container);
    for (const envFrom of asArray(c.envFrom)) {
      const ref = asRecord(envFrom);
      const name = asString(asRecord(ref.secretRef).name);
      if (name) refs.push({ name, refType: "envFrom" });
    }
    for (const env of asArray(c.env)) {
      const e = asRecord(env);
      const vf = asRecord(e.valueFrom);
      const name = asString(asRecord(vf.secretKeyRef).name);
      if (name) refs.push({ name, refType: "env" });
    }
  }

  // imagePullSecrets
  for (const ips of asArray(spec.imagePullSecrets)) {
    const name = asString(asRecord(ips).name);
    if (name) refs.push({ name, refType: "volume" });
  }

  return refs;
}

function getOwnerKindAndName(item: GenericItem): { kind: string; name: string } | null {
  const metadata = asRecord(item.metadata);
  const owners = asArray(metadata.ownerReferences);
  if (owners.length === 0) {
    return { kind: "Pod", name: asString(metadata.name) };
  }
  const owner = asRecord(owners[0]);
  return {
    kind: asString(owner.kind, "Pod"),
    name: asString(owner.name, asString(metadata.name)),
  };
}

export function buildConfigDependencyGraph(
  resourceKind: "ConfigMap" | "Secret",
  resourceName: string,
  resourceNamespace: string,
  pods: GenericItem[],
): DependencyGraphResult {
  const consumers: DependencyConsumer[] = [];
  const seen = new Set<string>();

  for (const pod of pods) {
    const metadata = asRecord(pod.metadata);
    const ns = asString(metadata.namespace);
    if (ns !== resourceNamespace) continue;

    const spec = asRecord(pod.spec);
    const refs =
      resourceKind === "ConfigMap"
        ? extractConfigMapRefsFromPodSpec(spec)
        : extractSecretRefsFromPodSpec(spec);

    for (const ref of refs) {
      if (ref.name !== resourceName) continue;
      const owner = getOwnerKindAndName(pod);
      if (!owner) continue;
      const key = `${owner.kind}:${ns}/${owner.name}:${ref.refType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      consumers.push({
        kind: owner.kind,
        name: owner.name,
        namespace: ns,
        refType: ref.refType,
      });
    }
  }

  return {
    resourceKind,
    resourceName,
    resourceNamespace,
    consumers,
    orphan: consumers.length === 0,
  };
}

export function buildBatchDependencyReport(
  resources: { kind: "ConfigMap" | "Secret"; name: string; namespace: string }[],
  pods: GenericItem[],
): DependencyGraphResult[] {
  return resources.map((r) => buildConfigDependencyGraph(r.kind, r.name, r.namespace, pods));
}
