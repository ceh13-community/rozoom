import { get } from "svelte/store";
import { nodesStore } from "./nodes-store";
import { updateClusterCheckPartially } from "../../cache-store";
import { parseNodes } from "$features/check-health/api/parsers";
import type { NodeItem } from "$shared/model/clusters";

export async function updateNodeHealth(clusterId: string): Promise<void> {
  const allNodes = get(nodesStore);
  const nodes = allNodes[clusterId] ?? [];

  if (!nodes.length) return;

  const checks = {
    nodes: parseNodes({ items: nodes as NodeItem[] }),
  };

  await updateClusterCheckPartially(clusterId, checks);
}
