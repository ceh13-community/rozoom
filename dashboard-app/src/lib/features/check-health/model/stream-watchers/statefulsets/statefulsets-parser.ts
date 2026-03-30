import type { StatefulSetItem } from "$shared/model/clusters";
import { createJsonWatchParser } from "../json-watch-parser";

export interface StatefulSetWatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED";
  object: Partial<StatefulSetItem>;
}

export const parseStatefulSetJsonLine =
  createJsonWatchParser<Partial<StatefulSetItem>>("statefulset");
