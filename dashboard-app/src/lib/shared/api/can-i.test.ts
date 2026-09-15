import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./kubectl-proxy", () => ({
  kubectlRawArgsFront: vi.fn(),
}));

import { kubectlRawArgsFront } from "./kubectl-proxy";
import { normalizeCanIStatus, runCanI } from "./can-i";

describe("normalizeCanIStatus", () => {
  it("maps yes/no output to allowed/denied", () => {
    expect(normalizeCanIStatus("yes\n", "", 0)).toBe("allowed");
    expect(normalizeCanIStatus("no\n", "", 0)).toBe("denied");
  });

  it("returns unknown on errors, non-zero exit, or unexpected output", () => {
    expect(normalizeCanIStatus("yes\n", "boom", 0)).toBe("unknown");
    expect(normalizeCanIStatus("yes\n", "", 1)).toBe("unknown");
    expect(normalizeCanIStatus("maybe", "", 0)).toBe("unknown");
  });
});

describe("runCanI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefixes auth can-i and normalizes the verdict", async () => {
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({ output: "no\n", errors: "", code: 0 });

    const status = await runCanI("cluster-a", ["delete", "deployments", "-n", "prod"]);

    expect(status).toBe("denied");
    expect(kubectlRawArgsFront).toHaveBeenCalledWith(
      ["auth", "can-i", "delete", "deployments", "-n", "prod"],
      { clusterId: "cluster-a", allowCommandUnavailable: true },
    );
  });
});
