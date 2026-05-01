import { describe, expect, it } from "vitest";
import {
  PSS_CHECK_CATALOG,
  PSS_SCAN_OVERVIEW,
  RBAC_RULE_CATALOG,
  RBAC_SCAN_OVERVIEW,
} from "./rule-catalog";

/**
 * These contract tests guard the link between the scanner (source of rule IDs)
 * and the catalog (source of UI descriptions). If the scanner adds a new rule
 * ID, the matching doc entry must exist here or the row will render a
 * generic/empty description.
 */

describe("rule catalog", () => {
  it("covers every rule ID produced by the RBAC scanner", async () => {
    const mod = await import("$features/workloads-management/model/rbac-risk-scanner");
    // Scanner emits findings only via the RISK_PATTERNS it closes over.
    // We can exercise it by scanning synthetic roles that trip each pattern.
    const { scanRoleRisks } = mod as unknown as {
      scanRoleRisks: (role: {
        name: string;
        namespace: string | null;
        kind: "Role" | "ClusterRole";
        rules: Array<{ apiGroups: string[]; resources: string[]; verbs: string[] }>;
      }) => { findings: Array<{ rule: string }> };
    };

    const synthetic = [
      { apiGroups: ["*"], resources: ["*"], verbs: ["*"] },
      { apiGroups: ["*"], resources: ["*"], verbs: ["get"] },
      { apiGroups: ["rbac.authorization.k8s.io"], resources: ["roles"], verbs: ["escalate"] },
      {
        apiGroups: ["rbac.authorization.k8s.io"],
        resources: ["rolebindings"],
        verbs: ["bind"],
      },
      { apiGroups: [""], resources: ["users"], verbs: ["impersonate"] },
      { apiGroups: [""], resources: ["nodes/proxy"], verbs: ["get"] },
      { apiGroups: [""], resources: ["secrets"], verbs: ["list"] },
      { apiGroups: [""], resources: ["pods/exec"], verbs: ["create"] },
      { apiGroups: [""], resources: ["persistentvolumes"], verbs: ["create"] },
      { apiGroups: [""], resources: ["serviceaccounts/token"], verbs: ["create"] },
      {
        apiGroups: ["admissionregistration.k8s.io"],
        resources: ["mutatingwebhookconfigurations"],
        verbs: ["patch"],
      },
      { apiGroups: [""], resources: ["pods"], verbs: ["create"] },
      { apiGroups: [""], resources: ["namespaces"], verbs: ["update"] },
    ];
    const role = {
      name: "probe",
      namespace: null,
      kind: "ClusterRole" as const,
      rules: synthetic,
    };
    const result = scanRoleRisks(role);
    const emittedRules = new Set(result.findings.map((f) => f.rule));

    for (const ruleId of emittedRules) {
      expect(RBAC_RULE_CATALOG[ruleId], `missing catalog entry for ${ruleId}`).toBeDefined();
    }
    // Also guard the reverse: every catalog entry should still map to a
    // rule the scanner can emit. Drift in either direction is a bug.
    for (const ruleId of Object.keys(RBAC_RULE_CATALOG)) {
      expect(emittedRules.has(ruleId), `orphan catalog entry ${ruleId}`).toBe(true);
    }
  });

  it("exposes a non-empty rule count that matches the catalog size", () => {
    expect(RBAC_SCAN_OVERVIEW.rulesCount).toBeGreaterThan(0);
    expect(RBAC_SCAN_OVERVIEW.rulesCount).toBe(Object.keys(RBAC_RULE_CATALOG).length);
  });

  it("has required doc fields on every RBAC entry", () => {
    for (const [id, doc] of Object.entries(RBAC_RULE_CATALOG)) {
      expect(doc.title.length, `title for ${id}`).toBeGreaterThan(0);
      expect(doc.why.length, `why for ${id}`).toBeGreaterThan(0);
      expect(doc.fix.length, `fix for ${id}`).toBeGreaterThan(0);
      expect(doc.docUrl.startsWith("https://"), `docUrl for ${id}`).toBe(true);
    }
  });

  it("has required doc fields on every PSS entry", () => {
    for (const [id, doc] of Object.entries(PSS_CHECK_CATALOG)) {
      expect(doc.title.length, `title for ${id}`).toBeGreaterThan(0);
      expect(doc.why.length, `why for ${id}`).toBeGreaterThan(0);
      expect(doc.fix.length, `fix for ${id}`).toBeGreaterThan(0);
      expect(doc.docUrl.startsWith("https://"), `docUrl for ${id}`).toBe(true);
    }
  });

  it("exposes a PSS overview link to upstream docs", () => {
    expect(PSS_SCAN_OVERVIEW.docUrl).toMatch(/pod-security-standards/);
  });

  it("covers every check ID produced by the PSS scanner", async () => {
    const mod = await import("$features/workloads-management/model/pss-compliance");
    const { checkPodCompliance } = mod as unknown as {
      checkPodCompliance: (pod: {
        namespace: string;
        pod: string;
        hostNetwork?: boolean;
        hostPID?: boolean;
        hostIPC?: boolean;
        volumes?: Array<{ hostPath?: { path: string } }>;
        securityContext?: { seccompProfile?: { type?: string } };
        containers: Array<{
          name: string;
          securityContext?: {
            privileged?: boolean;
            capabilities?: { add?: string[]; drop?: string[] };
            seccompProfile?: { type?: string };
            runAsNonRoot?: boolean;
            allowPrivilegeEscalation?: boolean;
          };
          ports?: Array<{ hostPort?: number }>;
        }>;
      }) => { violations: Array<{ check: string }> };
    };

    // Synthetic pod trips every Baseline + Restricted check simultaneously.
    const result = checkPodCompliance({
      namespace: "probe-ns",
      pod: "probe-pod",
      hostNetwork: true,
      hostPID: true,
      hostIPC: true,
      volumes: [{ hostPath: { path: "/" } }],
      securityContext: { seccompProfile: { type: "Unconfined" } },
      containers: [
        {
          name: "c",
          securityContext: {
            privileged: true,
            capabilities: { add: ["SYS_ADMIN"] },
            seccompProfile: { type: "Unconfined" },
          },
          ports: [{ hostPort: 80 }],
        },
      ],
    });
    const emitted = new Set(result.violations.map((v) => v.check));
    for (const id of emitted) {
      expect(PSS_CHECK_CATALOG[id], `missing catalog entry for ${id}`).toBeDefined();
    }
    // Orphan check: every catalog entry should correspond to an emitted id
    // for SOME input. Trigger the remaining restricted-only checks with a
    // second synthetic pod that satisfies Baseline.
    const strictResult = checkPodCompliance({
      namespace: "probe",
      pod: "bare",
      containers: [{ name: "c", securityContext: {} }],
    });
    for (const v of strictResult.violations) emitted.add(v.check);

    for (const id of Object.keys(PSS_CHECK_CATALOG)) {
      expect(emitted.has(id), `orphan catalog entry ${id}`).toBe(true);
    }
  });
});
