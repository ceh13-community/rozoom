import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseKubeEvents } from "./kube-events";

describe("parseKubeEvents", () => {
  it("takes the count from count, then series.count, and leaves it out when neither is set", () => {
    const events = parseKubeEvents(
      JSON.stringify({
        items: [
          { type: "Warning", reason: "BackOff", message: "a", count: 7 },
          { type: "Warning", reason: "BackOff", message: "b", series: { count: 12 } },
          { type: "Normal", reason: "Pulled", message: "c", count: 3, series: { count: 9 } },
          { type: "Normal", reason: "Started", message: "d", count: "4" },
          { type: "Normal", reason: "Scheduled", message: "e" },
        ],
      }),
    );
    expect(events.map((event) => event.count)).toEqual([7, 12, 3, 4, undefined]);
  });

  it("reads time and source the same way for every panel", () => {
    const [event] = parseKubeEvents(
      JSON.stringify({
        items: [
          {
            reason: "Created",
            eventTime: "2026-11-22T00:00:00Z",
            reportingController: "kubelet",
            source: { component: "other" },
          },
        ],
      }),
    );
    expect(event).toMatchObject({
      type: "-",
      lastTimestamp: "2026-11-22T00:00:00Z",
      source: "kubelet",
    });
  });

  // Every details panel reads its events through this parser, so xN works in all of them.
  it.each([
    "../../widgets/datalists/ui/deployments-list.svelte",
    "../../widgets/datalists/ui/daemon-sets-list.svelte",
    "../../widgets/datalists/ui/stateful-sets-list.svelte",
    "../../widgets/datalists/ui/replica-sets-list.svelte",
    "../../widgets/datalists/ui/jobs-list.svelte",
    "../../widgets/datalists/ui/cron-jobs-list.svelte",
    "../../widgets/datalists/ui/configuration-list.svelte",
    "../../widgets/datalists/ui/common/workload-events.ts",
    "../../widgets/datalists/ui/nodes-list/node-events.ts",
    "../../features/pod-details/model/load-pod-events.ts",
  ])("%s uses the shared parser", (file) => {
    const source = readFileSync(resolve(__dirname, file), "utf8");
    expect(source).toMatch(/\b(parseKubeEvents|toKubeEvent)\(/);
  });
});
