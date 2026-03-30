import type { WorkloadType } from "$shared/model/workloads";
import type { GenericJsonWatchEvent } from "../json-watch-parser";

export type ConfigurationWatchEvent = {
  type: "ADDED" | "MODIFIED" | "DELETED";
  object: Record<string, unknown>;
};

type RawConfigurationWatchEvent = GenericJsonWatchEvent<Record<string, unknown>>;

export function createConfigurationJsonLineParser(workloadType: WorkloadType) {
  return (line: string) => {
    try {
      const data = JSON.parse(line) as RawConfigurationWatchEvent | null;
      const metadata = data?.object.metadata as
        | { name?: string; resourceVersion?: string }
        | undefined;
      if (!data?.type || !metadata) return null;
      if (data.type !== "BOOKMARK" && !metadata.name) return null;
      return {
        kind: "configuration",
        event: {
          workloadType,
          event: data as ConfigurationWatchEvent,
        },
        resourceVersion: metadata.resourceVersion,
        shouldEmit: data.type !== "BOOKMARK",
      } as const;
    } catch {
      return null;
    }
  };
}
