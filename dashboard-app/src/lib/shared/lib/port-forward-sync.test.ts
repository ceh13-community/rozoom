import { describe, expect, it } from "vitest";
import { isRunningForwardByKey, selectLatestPortForwardsByTabId } from "./port-forward-sync";
import type { PortForwardProcess } from "$shared/api/port-forward";

function createForward(input: Partial<PortForwardProcess>): PortForwardProcess {
  return {
    command: {} as never,
    child: {} as never,
    isRunning: true,
    localPort: 8080,
    remotePort: 80,
    namespace: "default",
    resource: "svc/api",
    clusterId: "cluster-a",
    startedAt: 1,
    lastHeartbeatAt: null,
    lastMessage: null,
    lastError: null,
    closedAt: null,
    ...input,
  };
}

describe("port-forward-sync", () => {
  it("selects latest forward per tab id", () => {
    const selected = selectLatestPortForwardsByTabId(
      [
        { key: "a", forward: createForward({ startedAt: 10, localPort: 8080 }) },
        { key: "b", forward: createForward({ startedAt: 11, localPort: 18080 }) },
        {
          key: "c",
          forward: createForward({ resource: "svc/other", startedAt: 9, localPort: 9090 }),
        },
      ],
      (entry) => entry.forward.resource,
    );

    expect(selected).toHaveLength(2);
    expect(selected.find((entry) => entry.forward.resource === "svc/api")?.key).toBe("b");
    expect(selected.find((entry) => entry.forward.resource === "svc/other")?.key).toBe("c");
  });

  it("uses local port as tie breaker when startedAt is equal", () => {
    const selected = selectLatestPortForwardsByTabId(
      [
        { key: "a", forward: createForward({ startedAt: 10, localPort: 8080 }) },
        { key: "b", forward: createForward({ startedAt: 10, localPort: 18080 }) },
      ],
      () => "tab",
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.key).toBe("b");
  });

  it("detects running forward by unique key", () => {
    const active = {
      a: createForward({ isRunning: true }),
      b: createForward({ isRunning: false }),
    };

    expect(isRunningForwardByKey(active, "a")).toBe(true);
    expect(isRunningForwardByKey(active, "b")).toBe(false);
    expect(isRunningForwardByKey(active, "missing")).toBe(false);
  });

  it("returns original array for empty/singleton input", () => {
    const empty: Array<{ key: string; forward: PortForwardProcess }> = [];
    const single = [{ key: "a", forward: createForward({ startedAt: 3 }) }];

    expect(selectLatestPortForwardsByTabId(empty, () => "x")).toBe(empty);
    expect(selectLatestPortForwardsByTabId(single, () => "x")).toBe(single);
  });
});
