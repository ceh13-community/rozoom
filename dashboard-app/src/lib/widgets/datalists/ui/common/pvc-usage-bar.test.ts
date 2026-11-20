import { render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const kubectl = vi.hoisted(() => ({ kubectlRawArgsFront: vi.fn() }));
vi.mock("$shared/api/kubectl-proxy", () => kubectl);

import PvcUsageBar from "./pvc-usage-bar.svelte";
import { PVC_USAGE_NOTICES } from "./pvc-usage-notice";

const ok = (output: unknown) => ({ output: JSON.stringify(output), errors: "", code: 0 });
const failed = { output: "", errors: "Forbidden", code: 1 };
const podUsingClaim = {
  items: [
    {
      metadata: { name: "db-0" },
      spec: {
        nodeName: "node-a",
        volumes: [{ name: "data", persistentVolumeClaim: { claimName: "data" } }],
      },
    },
  ],
};

function renderBar() {
  return render(PvcUsageBar, { props: { clusterId: "c1", pvcName: "data", pvcNamespace: "db" } });
}

describe("PVC disk usage states", () => {
  beforeEach(() => {
    kubectl.kubectlRawArgsFront.mockReset();
  });

  it("explains that no pod uses the claim, as information, not as an error", async () => {
    kubectl.kubectlRawArgsFront.mockResolvedValueOnce(ok({ items: [] }));
    renderBar();

    const text = await screen.findByText(PVC_USAGE_NOTICES.noPodUsesClaim.text);
    expect(text.closest("[role=status]")).toBeNull();
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it("marks a failed pod list as an error with an icon and the next step", async () => {
    kubectl.kubectlRawArgsFront.mockResolvedValueOnce(failed);
    renderBar();

    const text = await screen.findByText(PVC_USAGE_NOTICES.cannotListPods.text);
    const status = text.closest("[role=status]");
    expect(status).not.toBeNull();
    expect(status?.querySelector("svg")).not.toBeNull();
  });

  it("names the permission when node stats cannot be read", async () => {
    kubectl.kubectlRawArgsFront
      .mockResolvedValueOnce(ok(podUsingClaim))
      .mockResolvedValueOnce(failed);
    renderBar();

    expect(await screen.findByText(/nodes\/proxy/)).toBeInTheDocument();
  });

  it("says when the node has no usage for the claim", async () => {
    kubectl.kubectlRawArgsFront
      .mockResolvedValueOnce(ok(podUsingClaim))
      .mockResolvedValueOnce(ok({ pods: [] }));
    renderBar();

    expect(await screen.findByText(PVC_USAGE_NOTICES.noStatsForClaim.text)).toBeInTheDocument();
  });

  it("asks to try again on an unexpected failure", async () => {
    kubectl.kubectlRawArgsFront.mockResolvedValueOnce({ output: "not json", errors: "", code: 0 });
    renderBar();

    expect(await screen.findByText(PVC_USAGE_NOTICES.failed.text)).toBeInTheDocument();
  });

  it("explains the Disk Usage label", async () => {
    kubectl.kubectlRawArgsFront.mockResolvedValueOnce(ok(podUsingClaim)).mockResolvedValueOnce(
      ok({
        pods: [
          {
            podRef: { namespace: "db" },
            volume: [{ pvcRef: { name: "data", namespace: "db" }, usedBytes: 1, capacityBytes: 4 }],
          },
        ],
      }),
    );
    renderBar();

    expect(await screen.findByText("Disk Usage")).toHaveAttribute(
      "title",
      "Used space on the volume, reported by the node that runs a pod using it.",
    );
  });
});
