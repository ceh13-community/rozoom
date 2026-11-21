import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";
import { expandWorkbenchOnRealtimeSwitch } from "./realtime-expand.svelte";

describe("expandWorkbenchOnRealtimeSwitch", () => {
  it("expands once on the switch to Realtime and keeps later collapses", () => {
    let profile = $state("balanced");
    let collapsed = $state(true);
    let expands = 0;
    const cleanup = $effect.root(() => {
      expandWorkbenchOnRealtimeSwitch(
        () => profile,
        () => {
          // Reads the state it writes, like the lists do: must not subscribe to it.
          if (collapsed) collapsed = false;
          expands += 1;
        },
      );
    });

    flushSync();
    expect(expands).toBe(0);
    expect(collapsed).toBe(true);

    profile = "realtime";
    flushSync();
    expect(collapsed).toBe(false);
    expect(expands).toBe(1);

    // The user collapses in Realtime: it stays collapsed.
    collapsed = true;
    flushSync();
    expect(collapsed).toBe(true);
    expect(expands).toBe(1);

    profile = "balanced";
    flushSync();
    profile = "realtime";
    flushSync();
    expect(expands).toBe(2);
    cleanup();
  });

  it("expands on mount when Realtime is already on", () => {
    let collapsed = $state(true);
    const cleanup = $effect.root(() => {
      expandWorkbenchOnRealtimeSwitch(
        () => "realtime",
        () => {
          collapsed = false;
        },
      );
    });
    flushSync();
    expect(collapsed).toBe(false);
    cleanup();
  });
});
