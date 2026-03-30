import { describe, expect, it } from "vitest";
import { createPolicyControlRows, filterPolicyControlRows } from "./policy-control-row";

describe("policy-control-row model", () => {
  it("adapts policy/control rows and filters by signal and risk", () => {
    const hpaRows = createPolicyControlRows(
      [
        {
          metadata: {
            uid: "hpa-1",
            name: "api-hpa",
            namespace: "default",
            creationTimestamp: "2026-03-01T00:00:00Z",
          },
          spec: { minReplicas: 2, maxReplicas: 6 },
          status: { currentReplicas: 2, desiredReplicas: 4 },
        },
      ],
      "horizontalpodautoscalers",
    );

    const webhookRows = createPolicyControlRows(
      [
        {
          metadata: {
            uid: "wh-1",
            name: "validate-team-a",
            creationTimestamp: "2026-03-02T00:00:00Z",
          },
          webhooks: [],
        },
      ],
      "validatingwebhookconfigurations",
    );

    expect(hpaRows[0]).toMatchObject({
      uid: "hpa-1",
      name: "api-hpa",
      scope: "default",
      kind: "HorizontalPodAutoscaler",
      risk: "medium",
    });
    expect(hpaRows[0].signal).toContain("replicas:");

    expect(webhookRows[0]).toMatchObject({
      uid: "wh-1",
      name: "validate-team-a",
      scope: "cluster",
      kind: "ValidatingWebhookConfiguration",
      risk: "medium",
    });
    expect(webhookRows[0].signal).toContain("webhooks: 0");

    expect(filterPolicyControlRows(hpaRows, "medium").map((row) => row.name)).toEqual(["api-hpa"]);
    expect(filterPolicyControlRows(webhookRows, "cluster").map((row) => row.name)).toEqual([
      "validate-team-a",
    ]);
  });
});
