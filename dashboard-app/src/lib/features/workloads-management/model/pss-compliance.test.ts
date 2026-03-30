import { describe, expect, it } from "vitest";
import { checkPodCompliance, buildPssReport } from "./pss-compliance";

describe("pss-compliance", () => {
  describe("checkPodCompliance", () => {
    it("passes restricted level for fully hardened pod", () => {
      const result = checkPodCompliance({
        namespace: "prod",
        pod: "secure-pod",
        securityContext: {
          runAsNonRoot: true,
          seccompProfile: { type: "RuntimeDefault" },
        },
        containers: [
          {
            name: "app",
            securityContext: {
              runAsNonRoot: true,
              allowPrivilegeEscalation: false,
              readOnlyRootFilesystem: true,
              capabilities: { drop: ["ALL"] },
              seccompProfile: { type: "RuntimeDefault" },
            },
          },
        ],
      });

      expect(result.maxCompliantLevel).toBe("restricted");
      expect(result.violations).toHaveLength(0);
    });

    it("fails baseline for privileged container", () => {
      const result = checkPodCompliance({
        namespace: "kube-system",
        pod: "priv-pod",
        containers: [
          {
            name: "priv",
            securityContext: { privileged: true },
          },
        ],
      });

      expect(result.maxCompliantLevel).toBe("privileged");
      expect(result.violations.some((v) => v.check === "privileged")).toBe(true);
    });

    it("fails baseline for hostNetwork", () => {
      const result = checkPodCompliance({
        namespace: "net",
        pod: "host-net",
        hostNetwork: true,
        containers: [{ name: "app" }],
      });

      expect(result.maxCompliantLevel).toBe("privileged");
      expect(result.violations.some((v) => v.check === "host-namespaces")).toBe(true);
    });

    it("fails baseline for hostPath volumes", () => {
      const result = checkPodCompliance({
        namespace: "storage",
        pod: "host-vol",
        volumes: [{ hostPath: { path: "/var/log" } }],
        containers: [{ name: "app" }],
      });

      expect(result.violations.some((v) => v.check === "host-path-volumes")).toBe(true);
    });

    it("fails baseline for dangerous capabilities", () => {
      const result = checkPodCompliance({
        namespace: "test",
        pod: "cap-pod",
        containers: [
          {
            name: "app",
            securityContext: {
              capabilities: { add: ["SYS_ADMIN", "NET_RAW"] },
            },
          },
        ],
      });

      expect(result.violations.some((v) => v.check === "capabilities")).toBe(true);
      expect(result.violations.find((v) => v.check === "capabilities")?.message).toContain(
        "SYS_ADMIN",
      );
    });

    it("allows safe baseline capabilities", () => {
      const result = checkPodCompliance({
        namespace: "test",
        pod: "safe-cap",
        containers: [
          {
            name: "app",
            securityContext: {
              capabilities: { add: ["NET_BIND_SERVICE", "CHOWN"] },
            },
          },
        ],
      });

      expect(result.violations.filter((v) => v.check === "capabilities")).toHaveLength(0);
    });

    it("fails restricted for missing runAsNonRoot", () => {
      const result = checkPodCompliance({
        namespace: "test",
        pod: "root-pod",
        containers: [{ name: "app" }],
      });

      expect(result.violations.some((v) => v.check === "run-as-non-root")).toBe(true);
    });

    it("fails restricted for missing drop ALL", () => {
      const result = checkPodCompliance({
        namespace: "test",
        pod: "no-drop",
        securityContext: { runAsNonRoot: true },
        containers: [
          {
            name: "app",
            securityContext: {
              runAsNonRoot: true,
              allowPrivilegeEscalation: false,
              seccompProfile: { type: "RuntimeDefault" },
            },
          },
        ],
      });

      expect(result.maxCompliantLevel).toBe("baseline");
      expect(result.violations.some((v) => v.check === "drop-all-capabilities")).toBe(true);
    });

    it("fails restricted for missing seccomp profile", () => {
      const result = checkPodCompliance({
        namespace: "test",
        pod: "no-seccomp",
        securityContext: { runAsNonRoot: true },
        containers: [
          {
            name: "app",
            securityContext: {
              runAsNonRoot: true,
              allowPrivilegeEscalation: false,
              capabilities: { drop: ["ALL"] },
            },
          },
        ],
      });

      expect(result.violations.some((v) => v.check === "seccomp-restricted")).toBe(true);
    });

    it("checks initContainers and ephemeralContainers too", () => {
      const result = checkPodCompliance({
        namespace: "test",
        pod: "init-priv",
        containers: [{ name: "app" }],
        initContainers: [{ name: "init", securityContext: { privileged: true } }],
      });

      expect(result.violations.some((v) => v.check === "privileged")).toBe(true);
      expect(result.maxCompliantLevel).toBe("privileged");
    });

    it("inherits pod-level runAsNonRoot", () => {
      const result = checkPodCompliance({
        namespace: "test",
        pod: "inherited",
        securityContext: {
          runAsNonRoot: true,
          seccompProfile: { type: "RuntimeDefault" },
        },
        containers: [
          {
            name: "app",
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ["ALL"] },
              seccompProfile: { type: "RuntimeDefault" },
            },
          },
        ],
      });

      expect(result.violations.filter((v) => v.check === "run-as-non-root")).toHaveLength(0);
    });
  });

  describe("buildPssReport", () => {
    it("summarizes compliance across pods", () => {
      const report = buildPssReport([
        {
          namespace: "a",
          pod: "restricted",
          securityContext: { runAsNonRoot: true, seccompProfile: { type: "RuntimeDefault" } },
          containers: [
            {
              name: "c",
              securityContext: {
                runAsNonRoot: true,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
                seccompProfile: { type: "RuntimeDefault" },
              },
            },
          ],
        },
        { namespace: "b", pod: "baseline", containers: [{ name: "c" }] },
        {
          namespace: "c",
          pod: "privileged",
          hostNetwork: true,
          containers: [{ name: "c", securityContext: { privileged: true } }],
        },
      ]);

      expect(report.summary.total).toBe(3);
      expect(report.summary.restrictedCompliant).toBe(1);
      expect(report.summary.baselineCompliant).toBe(1);
      expect(report.summary.privilegedOnly).toBe(1);
    });
  });
});
