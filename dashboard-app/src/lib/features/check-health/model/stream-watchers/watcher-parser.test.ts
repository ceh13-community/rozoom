import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventBus } from "./event-bus";
import { createJsonWatchParser } from "./json-watch-parser";
import { checkClusterEvent, registerParser, resetWatchParsersForTests } from "./watcher-parser";

describe("watcher-parser", () => {
  beforeEach(() => {
    eventBus.clear();
    resetWatchParsersForTests();
  });

  it("emits normal watch events to the event bus", () => {
    const listener = vi.fn();
    const unsubscribe = eventBus.subscribe(listener);

    registerParser(
      createJsonWatchParser<{ metadata?: { name?: string; resourceVersion?: string } }>("pod"),
    );
    const parsed = checkClusterEvent(
      "cluster-a",
      JSON.stringify({
        type: "MODIFIED",
        object: {
          metadata: {
            name: "demo",
            resourceVersion: "12",
          },
        },
      }),
    );

    expect(parsed?.resourceVersion).toBe("12");
    expect(listener).toHaveBeenCalledWith({
      clusterId: "cluster-a",
      kind: "pod",
      payload: {
        type: "MODIFIED",
        object: {
          metadata: {
            name: "demo",
            resourceVersion: "12",
          },
        },
      },
    });

    unsubscribe();
  });

  it("does not emit bookmark events to the event bus", () => {
    const listener = vi.fn();
    const unsubscribe = eventBus.subscribe(listener);

    registerParser(createJsonWatchParser<{ metadata?: { resourceVersion?: string } }>("pod"));
    const parsed = checkClusterEvent(
      "cluster-a",
      JSON.stringify({
        type: "BOOKMARK",
        object: {
          metadata: {
            resourceVersion: "15",
          },
        },
      }),
    );

    expect(parsed?.resourceVersion).toBe("15");
    expect(parsed?.shouldEmit).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });
});
