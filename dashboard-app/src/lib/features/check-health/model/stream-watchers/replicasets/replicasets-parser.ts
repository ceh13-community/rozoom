import type { ReplicaSetItem } from "$shared/model/clusters";
import { createJsonWatchParser } from "../json-watch-parser";

export interface ReplicaSetWatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED";
  object: Partial<ReplicaSetItem>;
}

export const parseReplicaSetJsonLine = createJsonWatchParser<Partial<ReplicaSetItem>>("replicaset");
