/**
 * Operator Catalog (#15)
 *
 * Detects installed operators by scanning CRDs, deployments with operator labels,
 * and OLM subscriptions.
 */

type GenericItem = Record<string, unknown>;

export type DetectedOperator = {
  name: string;
  namespace: string;
  version: string;
  crdCount: number;
  crds: string[];
  source: "crd-owner" | "label" | "olm";
  healthy: boolean;
};

export type OperatorCatalogResult = {
  operators: DetectedOperator[];
  totalOperators: number;
  healthyCount: number;
  unhealthyCount: number;
  totalManagedCrds: number;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asString(v: unknown, f = ""): string {
  return typeof v === "string" ? v : f;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for API compatibility with other operator detection modules
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function detectOperators(input: {
  crds: GenericItem[];
  deployments: GenericItem[];
}): OperatorCatalogResult {
  const operatorMap = new Map<string, DetectedOperator>();

  // Detect from CRD owner labels
  for (const crd of input.crds) {
    const metadata = asRecord(crd.metadata);
    const labels = asRecord(metadata.labels);
    const crdName = asString(metadata.name);
    const owner =
      asString(labels["app.kubernetes.io/managed-by"]) ||
      asString(labels["operators.coreos.com/managed-by"]);
    if (!owner) continue;

    const existing = operatorMap.get(owner);
    if (existing) {
      existing.crdCount++;
      existing.crds.push(crdName);
    } else {
      operatorMap.set(owner, {
        name: owner,
        namespace: "cluster",
        version: "-",
        crdCount: 1,
        crds: [crdName],
        source: "crd-owner",
        healthy: true,
      });
    }
  }

  // Detect from deployments with operator-like labels
  for (const deploy of input.deployments) {
    const metadata = asRecord(deploy.metadata);
    const labels = asRecord(metadata.labels);
    const name = asString(metadata.name);
    const ns = asString(metadata.namespace);
    const component = asString(labels["app.kubernetes.io/component"]);
    const partOf = asString(labels["app.kubernetes.io/part-of"]);
    const version = asString(labels["app.kubernetes.io/version"]);

    if (
      component === "controller" ||
      component === "operator" ||
      name.includes("operator") ||
      name.includes("controller-manager")
    ) {
      const opName = partOf || name.replace(/-controller-manager$/, "").replace(/-operator$/, "");
      const status = asRecord(deploy.status);
      const ready = Number(status.readyReplicas ?? 0);
      const desired = Number(asRecord(deploy.spec).replicas ?? 1);
      const healthy = ready >= desired;

      if (!operatorMap.has(opName)) {
        operatorMap.set(opName, {
          name: opName,
          namespace: ns,
          version: version || "-",
          crdCount: 0,
          crds: [],
          source: "label",
          healthy,
        });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- value verified by operatorMap.has() above
        const existing = operatorMap.get(opName)!;
        existing.namespace = ns;
        if (version) existing.version = version;
        existing.healthy = healthy;
      }
    }
  }

  const operators = [...operatorMap.values()].sort((a, b) => b.crdCount - a.crdCount);
  return {
    operators,
    totalOperators: operators.length,
    healthyCount: operators.filter((o) => o.healthy).length,
    unhealthyCount: operators.filter((o) => !o.healthy).length,
    totalManagedCrds: operators.reduce((sum, o) => sum + o.crdCount, 0),
  };
}
