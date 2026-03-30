import { storeManager } from "$shared/store";

const STORE_NAME = "dashboard-preferences.json";
const KEY = "clusterCardOrder";

export async function loadClusterOrder(): Promise<string[]> {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    const value = (await store.get(KEY)) as string[] | null;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function saveClusterOrder(uuids: string[]) {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    await store.set(KEY, uuids);
    await store.save();
  } catch {
    // ignore
  }
}

export function applyClusterOrder<T extends { uuid: string }>(clusters: T[], order: string[]): T[] {
  if (order.length === 0) return clusters;
  const indexMap = new Map(order.map((id, i) => [id, i]));
  return [...clusters].sort((a, b) => {
    const ia = indexMap.get(a.uuid) ?? Infinity;
    const ib = indexMap.get(b.uuid) ?? Infinity;
    return ia - ib;
  });
}
