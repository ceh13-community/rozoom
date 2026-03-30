import type { WarningEventItem } from "../../types";
import { setInitialOverviewWarningEvents } from "./warning-events-store";
import {
  startOverviewWarningEventsWatcher,
  stopOverviewWarningEventsWatcher,
} from "./warning-events-watcher";

export function initOverviewWarningEventsSync(
  clusterId: string,
  initialItems?: WarningEventItem[],
) {
  if (!clusterId) return;
  if (initialItems && initialItems.length > 0) {
    setInitialOverviewWarningEvents(clusterId, initialItems);
  }
  startOverviewWarningEventsWatcher(clusterId);
}

export function destroyOverviewWarningEventsSync(clusterId: string) {
  if (!clusterId) return;
  stopOverviewWarningEventsWatcher(clusterId);
}
