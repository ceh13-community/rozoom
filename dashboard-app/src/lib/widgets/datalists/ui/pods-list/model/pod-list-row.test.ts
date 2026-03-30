import { describe, expect, it, vi } from "vitest";
import type { PodItem } from "$shared/model/clusters";

vi.mock("./pod-row-adapter", () => ({
  buildPodListRow: (pod: {
    metadata?: { name?: string; namespace?: string };
    spec?: { nodeName?: string };
  }) => ({
    age: "1m",
    ageSeconds: 60,
    name: pod.metadata?.name ?? "",
    namespace: pod.metadata?.namespace ?? "default",
    node: pod.spec?.nodeName ?? "-",
    readyContainers: 1,
    restarts: 0,
    status: "Running",
    totalContainers: 1,
    uid: `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`,
  }),
}));

import { createPodListRows, filterPodListRows } from "./pod-list-row";

describe("pod list row model", () => {
  it("maps source pods through the adapter", () => {
    expect(
      createPodListRows([
        {
          metadata: { name: "api-0", namespace: "prod" },
          spec: { nodeName: "node-a" },
        } as unknown as Partial<PodItem>,
      ]),
    ).toEqual([
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
        uid: "prod/api-0",
      },
    ]);
  });

  it("filters rows by name, namespace, node, or status", () => {
    const rows = [
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
        uid: "prod/api-0",
      },
      {
        age: "2m",
        ageSeconds: 120,
        name: "jobs-0",
        namespace: "batch",
        node: "node-b",
        readyContainers: 1,
        restarts: 0,
        status: "Pending",
        totalContainers: 1,
        uid: "batch/jobs-0",
      },
    ];

    expect(filterPodListRows(rows, "prod")).toEqual([rows[0]]);
    expect(filterPodListRows(rows, "node-b")).toEqual([rows[1]]);
    expect(filterPodListRows(rows, "pending")).toEqual([rows[1]]);
    expect(filterPodListRows(rows, "")).toEqual(rows);
  });
});
