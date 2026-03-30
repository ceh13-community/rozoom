import { storeManager } from "$shared/store";

const STORE_NAME = "dashboard-preferences.json";
const GROUPS_KEY = "clusterGroups";
const MEMBERSHIP_KEY = "clusterGroupMembership";

export type ClusterGroup = {
  id: string;
  name: string;
  color?: string;
  collapsed?: boolean;
};

export async function loadGroups(): Promise<ClusterGroup[]> {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    const value = (await store.get(GROUPS_KEY)) as ClusterGroup[] | null;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function saveGroups(groups: ClusterGroup[]) {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    await store.set(GROUPS_KEY, groups);
    await store.save();
  } catch {
    // best-effort
  }
}

export async function loadGroupMembership(): Promise<Record<string, string>> {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    const value = (await store.get(MEMBERSHIP_KEY)) as Record<string, string> | null;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export async function saveGroupMembership(membership: Record<string, string>) {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    await store.set(MEMBERSHIP_KEY, membership);
    await store.save();
  } catch {
    // best-effort
  }
}

export function createGroup(name: string, color?: string): ClusterGroup {
  return {
    id: crypto.randomUUID(),
    name,
    color,
    collapsed: false,
  };
}

export function addGroup(groups: ClusterGroup[], name: string, color?: string): ClusterGroup[] {
  return [...groups, createGroup(name, color)];
}

export function removeGroup(
  groups: ClusterGroup[],
  membership: Record<string, string>,
  groupId: string,
): { groups: ClusterGroup[]; membership: Record<string, string> } {
  const nextGroups = groups.filter((g) => g.id !== groupId);
  const nextMembership = { ...membership };
  for (const [clusterId, gId] of Object.entries(nextMembership)) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- hot path, avoid copying
    if (gId === groupId) delete nextMembership[clusterId];
  }
  return { groups: nextGroups, membership: nextMembership };
}

export function renameGroup(groups: ClusterGroup[], groupId: string, name: string): ClusterGroup[] {
  return groups.map((g) => (g.id === groupId ? { ...g, name } : g));
}

export function toggleGroupCollapsed(groups: ClusterGroup[], groupId: string): ClusterGroup[] {
  return groups.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g));
}

export function assignClusterToGroup(
  membership: Record<string, string>,
  clusterId: string,
  groupId: string,
): Record<string, string> {
  return { ...membership, [clusterId]: groupId };
}

export function unassignCluster(
  membership: Record<string, string>,
  clusterId: string,
): Record<string, string> {
  const next = { ...membership };
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- hot path, avoid copying
  delete next[clusterId];
  return next;
}

export function moveClusterToGroup(
  membership: Record<string, string>,
  clusterId: string,
  groupId: string | null,
): Record<string, string> {
  if (groupId === null) return unassignCluster(membership, clusterId);
  return assignClusterToGroup(membership, clusterId, groupId);
}

export type GroupedClusters<T extends { uuid: string }> = {
  group: ClusterGroup | null;
  clusters: T[];
};

export function groupClusters<T extends { uuid: string }>(
  clusters: T[],
  groups: ClusterGroup[],
  membership: Record<string, string>,
): GroupedClusters<T>[] {
  const groupMap = new Map<string, T[]>();
  const ungrouped: T[] = [];

  for (const cluster of clusters) {
    const groupId = membership[cluster.uuid];
    if (groupId && groups.some((g) => g.id === groupId)) {
      const list = groupMap.get(groupId) ?? [];
      list.push(cluster);
      groupMap.set(groupId, list);
    } else {
      ungrouped.push(cluster);
    }
  }

  const result: GroupedClusters<T>[] = [];

  for (const group of groups) {
    const list = groupMap.get(group.id);
    if (list && list.length > 0) {
      result.push({ group, clusters: list });
    }
  }

  if (ungrouped.length > 0) {
    result.push({ group: null, clusters: ungrouped });
  }

  return result;
}
