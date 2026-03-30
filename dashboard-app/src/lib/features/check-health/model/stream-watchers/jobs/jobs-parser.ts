import type { JobItem } from "$shared/model/clusters";
import { createJsonWatchParser } from "../json-watch-parser";

export interface JobWatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED";
  object: Partial<JobItem>;
}

export const parseJobJsonLine = createJsonWatchParser<Partial<JobItem>>("job");
