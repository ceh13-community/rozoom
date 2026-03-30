import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
  kubectlRawArgsFront: vi.fn(),
}));

import { kubectlRawArgsFront, kubectlRawFront } from "$shared/api/kubectl-proxy";
import { fetchOverviewAccessProfile } from "./overview-access";

describe("overview-access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds access profile from whoami, kubeconfig, and can-i probes", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValue({
      output: JSON.stringify({
        "current-context": "dev",
        contexts: [{ name: "dev", context: { user: "ctx-user", namespace: "team-a" } }],
      }),
      errors: "",
      code: 0,
    });
    vi.mocked(kubectlRawArgsFront).mockImplementation(async (args: string[]) => {
      if (args[0] === "auth" && args[1] === "whoami") {
        return { output: "api-user\n", errors: "", code: 0 };
      }
      return {
        output: args.includes("nodes") || args.includes("kube-system") ? "no\n" : "yes\n",
        errors: "",
        code: 0,
      };
    });

    const profile = await fetchOverviewAccessProfile("cluster-a");

    expect(profile.subject).toBe("api-user");
    expect(profile.namespace).toBe("team-a");
    expect(profile.capabilities.find((item) => item.id === "pods_read")?.status).toBe("allowed");
    expect(profile.capabilities.find((item) => item.id === "nodes_read")?.status).toBe("denied");
    expect(profile.diagnosticsImpact.length).toBeGreaterThan(0);
  });

  it("falls back to kubeconfig identity when whoami is unavailable", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValue({
      output: JSON.stringify({
        "current-context": "dev",
        contexts: [{ name: "dev", context: { user: "ctx-user" } }],
      }),
      errors: "",
      code: 0,
    });
    vi.mocked(kubectlRawArgsFront).mockImplementation(async (args: string[]) => {
      if (args[0] === "auth" && args[1] === "whoami") {
        return { output: "", errors: "[ERROR] unknown command", code: 1 };
      }
      return { output: "yes\n", errors: "", code: 0 };
    });

    const profile = await fetchOverviewAccessProfile("cluster-a");

    expect(profile.subject).toBe("ctx-user");
    expect(profile.subjectSource).toBe("kubeconfig");
  });

  it("uses list verbs for inventory-style capability probes", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValue({
      output: JSON.stringify({
        "current-context": "dev",
        contexts: [{ name: "dev", context: { user: "ctx-user" } }],
      }),
      errors: "",
      code: 0,
    });
    vi.mocked(kubectlRawArgsFront).mockImplementation(async (args: string[]) => {
      if (args[0] === "auth" && args[1] === "whoami") {
        return { output: "api-user\n", errors: "", code: 0 };
      }
      return { output: "yes\n", errors: "", code: 0 };
    });

    await fetchOverviewAccessProfile("cluster-a");

    const canICalls = vi
      .mocked(kubectlRawArgsFront)
      .mock.calls.map(([args]) => args)
      .filter((args) => args[0] === "auth" && args[1] === "can-i");

    expect(canICalls).toEqual(
      expect.arrayContaining([
        ["auth", "can-i", "list", "pods", "--all-namespaces"],
        ["auth", "can-i", "list", "events", "--all-namespaces"],
        ["auth", "can-i", "list", "nodes"],
        ["auth", "can-i", "list", "pods", "-n", "kube-system"],
      ]),
    );
  });
});
