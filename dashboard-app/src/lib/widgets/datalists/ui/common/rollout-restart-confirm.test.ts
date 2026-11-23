import { beforeEach, describe, expect, it, vi } from "vitest";

const confirmAction = vi.hoisted(() => vi.fn(async () => true));
vi.mock("$shared/lib/confirm-action", () => ({ confirmAction }));

import {
  confirmRolloutRestart,
  describeRolloutRestart,
  rolloutRestartCommand,
  rolloutRestartTargets,
} from "./rollout-restart-confirm";

describe("rollout restart confirm", () => {
  beforeEach(() => {
    confirmAction.mockClear();
  });

  it("names the command for one target", () => {
    expect(rolloutRestartCommand("deployment", { name: "web", namespace: "shop" })).toBe(
      "rollout restart deployment/web --namespace shop",
    );
    expect(describeRolloutRestart("deployment", [{ name: "web", namespace: "shop" }])).toBe(
      "Restart the rollout of deployment shop/web? Every pod of it is recreated.\n\n" +
        "kubectl rollout restart deployment/web --namespace shop",
    );
  });

  it("lists every command for a selection", () => {
    expect(
      describeRolloutRestart("daemonset", [
        { name: "fluentd", namespace: "logging" },
        { name: "node-exporter", namespace: "monitoring" },
      ]),
    ).toBe(
      "Restart the rollout of 2 daemon sets? Every pod of them is recreated.\n\n" +
        "kubectl rollout restart daemonset/fluentd --namespace logging\n" +
        "kubectl rollout restart daemonset/node-exporter --namespace monitoring",
    );
    expect(describeRolloutRestart("statefulset", [{ name: "db", namespace: "data" }])).toContain(
      "stateful set data/db",
    );
  });

  it("lists at most ten commands and counts the rest", () => {
    const targets = Array.from({ length: 12 }, (_, i) => ({
      name: `web-${i}`,
      namespace: "shop",
    }));
    const lines = describeRolloutRestart("deployment", targets).split("\n");
    expect(lines[0]).toBe("Restart the rollout of 12 deployments? Every pod of them is recreated.");
    expect(lines.filter((line) => line.startsWith("kubectl "))).toHaveLength(10);
    expect(lines.at(-1)).toBe("and 2 more");
    expect(describeRolloutRestart("deployment", targets.slice(0, 10))).not.toContain("more");
  });

  it("asks through confirmAction with the Rollout restart title", async () => {
    await expect(
      confirmRolloutRestart("deployment", [{ name: "web", namespace: "shop" }]),
    ).resolves.toBe(true);
    expect(confirmAction).toHaveBeenCalledWith(
      expect.stringContaining("kubectl rollout restart deployment/web --namespace shop"),
      "Rollout restart",
    );

    confirmAction.mockResolvedValueOnce(false);
    await expect(
      confirmRolloutRestart("deployment", [{ name: "web", namespace: "shop" }]),
    ).resolves.toBe(false);
  });

  it("does not ask for an empty selection", async () => {
    await expect(confirmRolloutRestart("deployment", [])).resolves.toBe(false);
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it("reads targets from items and skips the ones without a name", () => {
    expect(
      rolloutRestartTargets([
        { metadata: { name: "web", namespace: "shop" } },
        { metadata: { name: "api" } },
        { metadata: {} },
        { metadata: null },
      ]),
    ).toEqual([
      { name: "web", namespace: "shop" },
      { name: "api", namespace: "default" },
    ]);
  });
});
