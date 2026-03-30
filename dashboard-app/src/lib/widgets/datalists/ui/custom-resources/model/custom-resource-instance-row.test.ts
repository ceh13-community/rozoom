import { describe, expect, it } from "vitest";
import { adaptCustomResourceInstanceRow } from "./custom-resource-instance-row";

describe("custom resource instance row adapter", () => {
  it("prefers status.phase when present", () => {
    const row = adaptCustomResourceInstanceRow({
      metadata: {
        name: "demo",
        namespace: "apps",
        uid: "1",
        creationTimestamp: "2026-03-13T10:00:00Z",
      },
      status: { phase: "Ready" },
    });
    expect(row.name).toBe("demo");
    expect(row.namespace).toBe("apps");
    expect(row.status).toBe("Ready");
  });

  it("falls back to conditions summary", () => {
    const row = adaptCustomResourceInstanceRow({
      metadata: { name: "demo", uid: "2" },
      status: { conditions: [{ type: "Available", status: "True" }] },
    });
    expect(row.status).toBe("Available=True");
  });
});
