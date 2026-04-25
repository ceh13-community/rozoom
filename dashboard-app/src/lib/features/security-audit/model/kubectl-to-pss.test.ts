import { describe, expect, it } from "vitest";
import { normalizePodsForPss } from "./kubectl-to-pss";

describe("normalizePodsForPss", () => {
  it("maps a compliant pod with one container", () => {
    const input = {
      items: [
        {
          metadata: { name: "app-1", namespace: "default" },
          spec: {
            containers: [
              {
                name: "app",
                securityContext: {
                  runAsNonRoot: true,
                  allowPrivilegeEscalation: false,
                  capabilities: { drop: ["ALL"] },
                  seccompProfile: { type: "RuntimeDefault" },
                },
              },
            ],
          },
        },
      ],
    };
    const result = normalizePodsForPss(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.pod).toBe("app-1");
    expect(result[0]?.namespace).toBe("default");
    expect(result[0]?.containers[0]?.name).toBe("app");
  });

  it("preserves hostNetwork/hostPID/hostIPC flags", () => {
    const input = {
      items: [
        {
          metadata: { name: "p", namespace: "kube-system" },
          spec: {
            hostNetwork: true,
            hostPID: true,
            hostIPC: true,
            containers: [{ name: "c" }],
          },
        },
      ],
    };
    const result = normalizePodsForPss(input);
    expect(result[0]?.hostNetwork).toBe(true);
    expect(result[0]?.hostPID).toBe(true);
    expect(result[0]?.hostIPC).toBe(true);
  });

  it("filters out volumes without a hostPath", () => {
    const input = {
      items: [
        {
          metadata: { name: "p", namespace: "ns" },
          spec: {
            volumes: [{ hostPath: { path: "/data" } }, { hostPath: undefined }],
            containers: [{ name: "c" }],
          },
        },
      ],
    };
    const result = normalizePodsForPss(input);
    expect(result[0]?.volumes).toEqual([{ hostPath: { path: "/data" } }]);
  });

  it("collapses empty volume list to undefined", () => {
    const input = {
      items: [
        {
          metadata: { name: "p", namespace: "ns" },
          spec: { volumes: [{}], containers: [{ name: "c" }] },
        },
      ],
    };
    const result = normalizePodsForPss(input);
    expect(result[0]?.volumes).toBeUndefined();
  });

  it("includes init and ephemeral containers alongside main containers", () => {
    const input = {
      items: [
        {
          metadata: { name: "p", namespace: "ns" },
          spec: {
            containers: [{ name: "app" }],
            initContainers: [{ name: "migrate" }],
            ephemeralContainers: [{ name: "debug" }],
          },
        },
      ],
    };
    const result = normalizePodsForPss(input);
    expect(result[0]?.initContainers?.map((c) => c.name)).toEqual(["migrate"]);
    expect(result[0]?.ephemeralContainers?.map((c) => c.name)).toEqual(["debug"]);
  });

  it("skips pods with no containers (unschedulable)", () => {
    const input = {
      items: [
        {
          metadata: { name: "malformed", namespace: "ns" },
          spec: { containers: [] },
        },
      ],
    };
    expect(normalizePodsForPss(input)).toHaveLength(0);
  });

  it("skips pods without name or namespace metadata", () => {
    const input = {
      items: [
        { spec: { containers: [{ name: "c" }] } },
        { metadata: { name: "only-name" }, spec: { containers: [{ name: "c" }] } },
        { metadata: { namespace: "only-ns" }, spec: { containers: [{ name: "c" }] } },
      ],
    };
    expect(normalizePodsForPss(input)).toHaveLength(0);
  });

  it("returns empty list on null response (cluster unreachable)", () => {
    expect(normalizePodsForPss(null)).toEqual([]);
  });
});
