import type { CronJobItem } from "$shared/model/clusters";
import { createJsonWatchParser } from "../json-watch-parser";

export interface CronJobWatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED";
  object: Partial<CronJobItem>;
}

export const parseCronJobJsonLine = createJsonWatchParser<Partial<CronJobItem>>("cronjob");
