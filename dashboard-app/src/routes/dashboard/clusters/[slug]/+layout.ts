import { selectedNamespace } from "$features/namespace-management";
import { initWatchParsers } from "$features/check-health";

export const load = () => {
  /**
   * Initialize watcher parsers on client side
   * TODO: maybe better to use `browser` from $app/environment ?
   */
  if (typeof window !== "undefined") {
    initWatchParsers();
  }

  selectedNamespace.set("all");
};
