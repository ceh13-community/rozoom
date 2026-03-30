import type { NodeWatchEvent } from "./nodes-parser";
import { nodesStore } from "./nodes-store";
import { updateNodeHealth } from "./node-health-updater";

export function applyNodeEvent(clusterId: string, event: NodeWatchEvent) {
  nodesStore.update((state) => {
    const list = [...(state[clusterId] ?? [])];

    switch (event.type) {
      case "ADDED":
      case "MODIFIED": {
        const idx = list.findIndex((n) => n.metadata?.name === event.object.metadata?.name);

        if (idx === -1) list.push(event.object);
        else list[idx] = event.object;

        break;
      }

      case "DELETED":
        return {
          ...state,
          [clusterId]: list.filter((n) => n.metadata?.name !== event.object.metadata?.name),
        };
    }

    return { ...state, [clusterId]: list };
  });

  void updateNodeHealth(clusterId);
}
