import { beforeEach, describe, expect, it, vi } from "vitest";
import { discoverTriageResourceSupport, resetTriageDiscoveryCache } from "./triage-discovery";
import { getGlobalTriageManifest } from "./triage-manifest";

const mockKubectlRawArgsFront = vi.hoisted(() => vi.fn());

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: mockKubectlRawArgsFront,
}));

describe("triage discovery", () => {
  beforeEach(() => {
    resetTriageDiscoveryCache();
    mockKubectlRawArgsFront.mockReset();
  });

  it("splits supported and unsupported resources using api-resources discovery", async () => {
    mockKubectlRawArgsFront.mockResolvedValue({
      output: "pods\nnamespaces\nservices\nnetworkpolicies.networking.k8s.io\n",
      errors: "",
      code: 0,
    });

    const manifest = getGlobalTriageManifest();
    const result = await discoverTriageResourceSupport("cluster-a", manifest);

    expect(result.supported.some((entry) => entry.key === "pods")).toBe(true);
    expect(result.supported.some((entry) => entry.key === "networkpolicies")).toBe(true);
    expect(result.unsupported.some((entry) => entry.key === "deployments")).toBe(true);
  });
});
