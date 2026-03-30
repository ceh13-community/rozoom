import type { DeploymentItem } from "$shared";
import { createJsonWatchParser } from "../json-watch-parser";

export interface DeploymentWatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED";
  object: Partial<DeploymentItem>;
}

export const parseDeploymentJsonLine = createJsonWatchParser<Partial<DeploymentItem>>("deployment");
