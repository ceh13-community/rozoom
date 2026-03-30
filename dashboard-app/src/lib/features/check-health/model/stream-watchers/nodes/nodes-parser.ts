import type { NodeItem } from "$shared/model/clusters";

export interface NodeWatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED";
  object: Partial<NodeItem>;
}

export function parseNodeJsonLine(line: string) {
  try {
    const data = JSON.parse(line) as NodeWatchEvent | null;

    if (!data?.type || !data.object.metadata?.name) return null;

    return {
      kind: "node",
      event: data,
    } as const;
  } catch {
    return null;
  }
}
