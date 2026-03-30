import type { DaemonSetItem } from "$shared/model/clusters";
import { createJsonWatchParser } from "../json-watch-parser";

export interface DaemonSetWatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED";
  object: Partial<DaemonSetItem>;
}

export const parseDaemonSetJsonLine = createJsonWatchParser<Partial<DaemonSetItem>>("daemonset");
