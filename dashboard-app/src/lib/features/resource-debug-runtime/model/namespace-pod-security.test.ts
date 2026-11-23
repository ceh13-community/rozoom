import { describe, expect, it, vi } from "vitest";
import { createNamespacePodSecurityReader } from "./namespace-pod-security";

type Levels = Map<string, string> | null;

/** A load whose promises resolve only when the test says so: one queue of pending reads per cluster. */
function deferredLoad() {
  const pending = new Map<string, Array<(levels: Levels) => void>>();
  const load = vi.fn(
    (clusterId: string) =>
      new Promise<Levels>((resolve) => {
        pending.set(clusterId, [...(pending.get(clusterId) ?? []), resolve]);
      }),
  );
  /** Resolves the oldest pending read of that cluster. */
  const resolve = (clusterId: string, levels: Levels) => {
    const queue = pending.get(clusterId) ?? [];
    queue.shift()?.(levels);
  };
  return { load, resolve };
}

describe("namespace Pod Security reader", () => {
  it("clears the levels at once and applies the read for the cluster it was pointed at", async () => {
    const onLevels = vi.fn<(levels: Levels) => void>();
    const { load, resolve } = deferredLoad();
    const reader = createNamespacePodSecurityReader(onLevels, load);

    const done = reader.use("c1");
    expect(onLevels).toHaveBeenLastCalledWith(null);
    resolve("c1", new Map([["shop", "baseline"]]));
    await done;

    expect(load).toHaveBeenCalledWith("c1");
    expect(onLevels).toHaveBeenLastCalledWith(new Map([["shop", "baseline"]]));
  });

  it("drops a read that finishes after the reader moved to another cluster", async () => {
    const onLevels = vi.fn<(levels: Levels) => void>();
    const { load, resolve } = deferredLoad();
    const reader = createNamespacePodSecurityReader(onLevels, load);

    const first = reader.use("c1");
    const second = reader.use("c2");
    resolve("c2", new Map([["shop", "privileged"]]));
    await second;
    // The slow answer for c1 arrives last: it must not overwrite c2's levels.
    resolve("c1", new Map([["shop", "baseline"]]));
    await first;

    expect(onLevels).toHaveBeenLastCalledWith(new Map([["shop", "privileged"]]));
    expect(onLevels.mock.calls.filter(([l]) => l?.get("shop") === "baseline")).toHaveLength(0);
  });

  it("refresh reads the current cluster again and applies the newer levels; a superseded refresh is dropped", async () => {
    const onLevels = vi.fn<(levels: Levels) => void>();
    const { load, resolve } = deferredLoad();
    const reader = createNamespacePodSecurityReader(onLevels, load);
    const used = reader.use("c1");
    resolve("c1", new Map([["shop", "baseline"]]));
    await used;

    // The menu opened twice before the first refresh answered.
    const stale = reader.refresh();
    const fresh = reader.refresh();
    resolve("c1", new Map([["shop", "baseline"]])); // answer of the first refresh
    resolve("c1", new Map()); // answer of the second: the label was removed meanwhile
    await Promise.all([stale, fresh]);

    expect(load).toHaveBeenCalledTimes(3);
    expect(onLevels).toHaveBeenLastCalledWith(new Map());
    // The superseded refresh never reported its (older) levels after the newer one.
    const reports = onLevels.mock.calls.map(([l]) => (l ? [...l.entries()] : null));
    expect(reports.at(-1)).toEqual([]);
    expect(reports.filter((r) => r && r.length > 0)).toHaveLength(1);
  });

  it("with no cluster it reports null and never loads", async () => {
    const onLevels = vi.fn<(levels: Levels) => void>();
    const { load } = deferredLoad();
    const reader = createNamespacePodSecurityReader(onLevels, load);

    await reader.use(null);
    await reader.refresh();

    expect(load).not.toHaveBeenCalled();
    expect(onLevels).toHaveBeenLastCalledWith(null);
  });
});
