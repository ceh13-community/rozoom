import { describe, expect, it } from "vitest";
import { mapDeploymentRows } from "./map-deployment-rows";

describe("mapDeploymentRows", () => {
  it("maps deployments into table rows", () => {
    const rows = mapDeploymentRows([
      {
        metadata: {
          name: "demo",
          namespace: "default",
          creationTimestamp: new Date().toISOString(),
        },
        spec: {
          replicas: 2,
          template: {
            spec: {
              nodeName: "node-a",
            },
          },
        },
        status: {
          readyReplicas: 1,
          replicas: 2,
          availableReplicas: 1,
        },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.uid).toBe("default/demo");
    expect(rows[0]?.ready).toBe("1/2");
    expect(rows[0]?.node).toBe("node-a");
  });
});
