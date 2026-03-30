import type { PodItem } from "$shared/model/clusters";
import { createJsonWatchParser } from "../json-watch-parser";

export interface PodWatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED";
  object: Partial<PodItem>;
}

export const parsePodJsonLine = createJsonWatchParser<Partial<PodItem>>("pod");
