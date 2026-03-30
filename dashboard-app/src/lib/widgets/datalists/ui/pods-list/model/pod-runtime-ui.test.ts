import { describe, expect, it } from "vitest";
import {
  buildPodMetricsSummary,
  isPodLiveUsageEligible,
  shouldShowPodsCacheBanner,
} from "./pod-runtime-ui";

describe("pod runtime ui", () => {
  it("shows the cache banner only while cached refresh is loading or degraded", () => {
    expect(
      shouldShowPodsCacheBanner({
        hasCachedPods: true,
        snapshotRefreshState: "idle",
        syncError: null,
        syncLoading: false,
      }),
    ).toBe(false);

    expect(
      shouldShowPodsCacheBanner({
        hasCachedPods: true,
        snapshotRefreshState: "loading",
        syncError: null,
        syncLoading: false,
      }),
    ).toBe(true);
  });

  it("treats terminal pod states as ineligible for live usage", () => {
    expect(
      isPodLiveUsageEligible({
        age: "1m",
        ageSeconds: 60,
        name: "api-0",
        namespace: "prod",
        node: "node-a",
        readyContainers: 0,
        restarts: 0,
        status: "Completed",
        totalContainers: 1,
        uid: "uid-1",
      }),
    ).toBe(false);

    expect(
      isPodLiveUsageEligible({
        age: "1m",
        ageSeconds: 60,
        name: "api-1",
        namespace: "prod",
        node: "node-a",
        readyContainers: 1,
        restarts: 0,
        status: "Running",
        totalContainers: 1,
        uid: "uid-2",
      }),
    ).toBe(true);
  });

  it("explains when terminal pods are the reason for missing live usage", () => {
    const summary = buildPodMetricsSummary({
      enrichedTableEnabled: true,
      metricsLoading: false,
      metricsError: null,
      metricsCoverageCount: 11,
      rows: [
        {
          age: "1m",
          ageSeconds: 60,
          name: "api-0",
          namespace: "prod",
          node: "node-a",
          readyContainers: 1,
          restarts: 0,
          status: "Running",
          totalContainers: 1,
          uid: "uid-1",
        },
        {
          age: "2m",
          ageSeconds: 120,
          name: "job-0",
          namespace: "jobs",
          node: "node-a",
          readyContainers: 0,
          restarts: 0,
          status: "Completed",
          totalContainers: 1,
          uid: "uid-2",
        },
      ],
    });

    expect(summary).toBe(
      "Live usage visible for 11/1 active pods. 1 terminal pod does not report live usage.",
    );
  });
});
