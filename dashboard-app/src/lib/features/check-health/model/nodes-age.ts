import type { NodeItem } from "$shared/model/clusters";

const nodeAgeCache = new Map<string, number>();

function getNodeKey(node: Partial<NodeItem>): string | undefined {
  return node.metadata?.uid ?? node.metadata?.name;
}

export function upsertNodesAge(nodes: Array<Partial<NodeItem>>) {
  for (const node of nodes) {
    const key = getNodeKey(node);
    if (!key) continue;

    if (!nodeAgeCache.has(key)) {
      const ts = node.metadata?.creationTimestamp;
      if (!ts) continue;
      nodeAgeCache.set(key, new Date(ts).getTime());
    }
  }
}

export function removeNodeAge(key: string) {
  nodeAgeCache.delete(key);
}

export function getNodeCreatedAt(key: string): Date | undefined {
  const value = nodeAgeCache.get(key);
  return value !== undefined ? new Date(value) : undefined;
}

export function clearNodesAge() {
  nodeAgeCache.clear();
}
