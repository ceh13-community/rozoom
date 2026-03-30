export type QuickFilterId =
  | "all"
  | "problems"
  | "unbound"
  | "no-ingress-rules"
  | "no-policy-types"
  | "default-storageclass"
  | "no-subjects"
  | "wildcard-rules"
  | "crd-non-structural"
  | "crd-deprecated-versions"
  | "orphan-pv"
  | "drifted";

export type QuickFilterRow = {
  problemScore: number;
  phase: string;
  ports: number;
  isDefaultStorageClass: boolean;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function applyQuickFilterRows<T extends QuickFilterRow>(
  rows: T[],
  quickFilter: QuickFilterId,
): T[] {
  switch (quickFilter) {
    case "problems":
      return rows.filter((row) => row.problemScore > 0);
    case "unbound":
      return rows.filter((row) => row.phase.toLowerCase() !== "bound");
    case "no-ingress-rules":
      return rows.filter((row) => row.ports === 0);
    case "no-policy-types":
      return rows.filter((row) => asArray(asRecord(row.raw.spec).policyTypes).length === 0);
    case "default-storageclass":
      return rows.filter((row) => row.isDefaultStorageClass);
    case "no-subjects":
      return rows.filter((row) => asArray(asRecord(row.raw).subjects).length === 0);
    case "wildcard-rules":
      return rows.filter((row) => {
        const rules = asArray(asRecord(row.raw).rules);
        return rules.some((rule) => {
          const item = asRecord(rule);
          const verbs = asArray(item.verbs).map((entry) => String(entry));
          const resources = asArray(item.resources).map((entry) => String(entry));
          const apiGroups = asArray(item.apiGroups).map((entry) => String(entry));
          return verbs.includes("*") || resources.includes("*") || apiGroups.includes("*");
        });
      });
    case "crd-non-structural":
      return rows.filter((row) => {
        const spec = asRecord(asRecord(row.raw).spec);
        const preserveUnknownFields = spec.preserveUnknownFields === true;
        const conditions = asArray(
          asRecord(row.raw).status ? asRecord(asRecord(row.raw).status).conditions : [],
        );
        const hasNonStructuralCondition = conditions.some((condition) => {
          const item = asRecord(condition);
          return String(item.type) === "NonStructuralSchema" && String(item.status) === "True";
        });
        return preserveUnknownFields || hasNonStructuralCondition;
      });
    case "crd-deprecated-versions":
      return rows.filter((row) => {
        const versions = asArray(asRecord(asRecord(row.raw).spec).versions);
        return versions.some((version) => asRecord(version).deprecated === true);
      });
    case "orphan-pv":
      return rows.filter((row) => {
        const spec = asRecord(row.raw.spec);
        const claimRef = asRecord(spec.claimRef);
        const status = asRecord(row.raw.status);
        const phaseRaw = status.phase;
        const phase = (typeof phaseRaw === "string" ? phaseRaw : "").toLowerCase();
        return (
          (!claimRef.name || claimRef.name === "") &&
          (phase === "available" || phase === "released")
        );
      });
    case "drifted":
      return rows.filter((row) => {
        const metadata = asRecord(row.raw.metadata);
        const annotations = asRecord(metadata.annotations);
        const lastApplied = annotations["kubectl.kubernetes.io/last-applied-configuration"];
        if (typeof lastApplied !== "string" || lastApplied.trim().length === 0) return false;
        try {
          const parsed = JSON.parse(lastApplied) as Record<string, unknown>;
          return JSON.stringify(asRecord(parsed.spec)) !== JSON.stringify(asRecord(row.raw.spec));
        } catch {
          return false;
        }
      });
    default:
      return rows;
  }
}
