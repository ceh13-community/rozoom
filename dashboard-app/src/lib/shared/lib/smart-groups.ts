import { storeManager } from "$shared/store";

const STORE_NAME = "dashboard-preferences.json";
const SMART_GROUPS_KEY = "smartGroups";

export type SmartGroupRule = {
  field: "provider" | "env" | "tags" | "name";
  operator: "equals" | "contains" | "matches";
  value: string;
};

export type SmartGroup = {
  id: string;
  name: string;
  rules: SmartGroupRule[];
  matchAll: boolean;
  color?: string;
  collapsed?: boolean;
};

export async function loadSmartGroups(): Promise<SmartGroup[]> {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    const value = (await store.get(SMART_GROUPS_KEY)) as SmartGroup[] | null;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function saveSmartGroups(groups: SmartGroup[]) {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    await store.set(SMART_GROUPS_KEY, groups);
    await store.save();
  } catch {
    // best-effort
  }
}

export function createSmartGroup(
  name: string,
  rules: SmartGroupRule[],
  matchAll = true,
  color?: string,
): SmartGroup {
  return {
    id: crypto.randomUUID(),
    name,
    rules,
    matchAll,
    color,
    collapsed: false,
  };
}

type ClusterLike = {
  uuid: string;
  name: string;
  provider?: string;
  env?: string;
  tags?: string[];
};

function getFieldValue(cluster: ClusterLike, field: SmartGroupRule["field"]): string | string[] {
  switch (field) {
    case "provider":
      return cluster.provider ?? "";
    case "env":
      return cluster.env ?? "";
    case "tags":
      return cluster.tags ?? [];
    case "name":
      return cluster.name;
  }
}

function matchesRule(cluster: ClusterLike, rule: SmartGroupRule): boolean {
  const fieldValue = getFieldValue(cluster, rule.field);

  if (Array.isArray(fieldValue)) {
    switch (rule.operator) {
      case "equals":
        return fieldValue.some((v) => v.toLowerCase() === rule.value.toLowerCase());
      case "contains":
        return fieldValue.some((v) => v.toLowerCase().includes(rule.value.toLowerCase()));
      case "matches":
        try {
          const re = new RegExp(rule.value, "i");
          return fieldValue.some((v) => re.test(v));
        } catch {
          return false;
        }
    }
  }

  const str = typeof fieldValue === "string" ? fieldValue : "";
  switch (rule.operator) {
    case "equals":
      return str.toLowerCase() === rule.value.toLowerCase();
    case "contains":
      return str.toLowerCase().includes(rule.value.toLowerCase());
    case "matches":
      try {
        return new RegExp(rule.value, "i").test(str);
      } catch {
        return false;
      }
  }
}

export function clusterMatchesSmartGroup(cluster: ClusterLike, group: SmartGroup): boolean {
  if (group.rules.length === 0) return false;
  return group.matchAll
    ? group.rules.every((rule) => matchesRule(cluster, rule))
    : group.rules.some((rule) => matchesRule(cluster, rule));
}

export type SmartGroupResult<T extends ClusterLike> = {
  group: SmartGroup;
  clusters: T[];
};

export function evaluateSmartGroups<T extends ClusterLike>(
  clusters: T[],
  smartGroups: SmartGroup[],
): { grouped: SmartGroupResult<T>[]; ungrouped: T[] } {
  const assigned = new Set<string>();
  const grouped: SmartGroupResult<T>[] = [];

  for (const group of smartGroups) {
    const matching = clusters.filter(
      (c) => !assigned.has(c.uuid) && clusterMatchesSmartGroup(c, group),
    );
    if (matching.length > 0) {
      grouped.push({ group, clusters: matching });
      for (const c of matching) assigned.add(c.uuid);
    }
  }

  const ungrouped = clusters.filter((c) => !assigned.has(c.uuid));
  return { grouped, ungrouped };
}
