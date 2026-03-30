/**
 * RBAC Diff (#13)
 *
 * Compare two roles/clusterroles rule-by-rule.
 */

type GenericItem = Record<string, unknown>;

export type RbacRuleDiff = {
  resource: string;
  verbs: { left: string[]; right: string[]; added: string[]; removed: string[] };
  status: "identical" | "modified" | "added" | "removed";
};

export type RbacDiffResult = {
  leftName: string;
  rightName: string;
  rules: RbacRuleDiff[];
  identical: boolean;
  addedRules: number;
  removedRules: number;
  modifiedRules: number;
};

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asString(v: unknown, f = ""): string {
  return typeof v === "string" ? v : f;
}

function extractRuleMap(item: GenericItem): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const rule of asArray(asRecord(item).rules)) {
    const r = asRecord(rule);
    const resources = asArray(r.resources).map(String);
    const verbs = asArray(r.verbs).map(String);
    for (const res of resources.length ? resources : ["*"]) {
      const existing = map.get(res) ?? [];
      map.set(res, [...new Set([...existing, ...verbs])]);
    }
  }
  return map;
}

export function diffRbacRoles(left: GenericItem, right: GenericItem): RbacDiffResult {
  const leftName = asString(asRecord(left.metadata).name, "left");
  const rightName = asString(asRecord(right.metadata).name, "right");
  const leftRules = extractRuleMap(left);
  const rightRules = extractRuleMap(right);
  const allResources = new Set([...leftRules.keys(), ...rightRules.keys()]);

  const rules: RbacRuleDiff[] = [];
  let addedRules = 0,
    removedRules = 0,
    modifiedRules = 0;

  for (const resource of allResources) {
    const lVerbs = leftRules.get(resource) ?? [];
    const rVerbs = rightRules.get(resource) ?? [];
    const added = rVerbs.filter((v) => !lVerbs.includes(v));
    const removed = lVerbs.filter((v) => !rVerbs.includes(v));

    let status: RbacRuleDiff["status"] = "identical";
    if (lVerbs.length === 0) {
      status = "added";
      addedRules++;
    } else if (rVerbs.length === 0) {
      status = "removed";
      removedRules++;
    } else if (added.length > 0 || removed.length > 0) {
      status = "modified";
      modifiedRules++;
    }

    rules.push({ resource, verbs: { left: lVerbs, right: rVerbs, added, removed }, status });
  }

  rules.sort((a, b) => {
    const order = { removed: 0, modified: 1, added: 2, identical: 3 };
    return order[a.status] - order[b.status];
  });

  return {
    leftName,
    rightName,
    rules,
    identical: addedRules === 0 && removedRules === 0 && modifiedRules === 0,
    addedRules,
    removedRules,
    modifiedRules,
  };
}
