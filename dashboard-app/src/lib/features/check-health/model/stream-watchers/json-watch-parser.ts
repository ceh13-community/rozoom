export type GenericJsonWatchEvent<T> = {
  type: "ADDED" | "MODIFIED" | "DELETED" | "BOOKMARK";
  object: T;
};

type WatchMetadata = {
  name?: string;
  resourceVersion?: string;
};

export function createJsonWatchParser<T extends { metadata?: WatchMetadata }>(kind: string) {
  return (line: string) => {
    try {
      const data = JSON.parse(line) as GenericJsonWatchEvent<T> | null;
      const metadata = data?.object.metadata;
      if (!data?.type || !metadata) return null;
      if (data.type !== "BOOKMARK" && !metadata.name) return null;
      return {
        kind,
        event: data,
        resourceVersion: metadata.resourceVersion,
        shouldEmit: data.type !== "BOOKMARK",
      } as const;
    } catch {
      return null;
    }
  };
}
