/**
 * UI-side documentation for every RBAC risk pattern and every PSS check
 * emitted by the scanners. Keeps the panel presentation aligned with the
 * rule IDs produced by `buildRbacRiskReport` / `buildPssReport` without
 * duplicating the detection logic.
 *
 * Each entry carries:
 *   - `title`: short label suitable for lists
 *   - `why`: one-sentence rationale (shown in the finding row)
 *   - `fix`: actionable remediation hint (shown when a finding is expanded)
 *   - `docUrl`: upstream reference so users can verify independently
 */

export type RbacRuleDoc = {
  title: string;
  why: string;
  fix: string;
  docUrl: string;
};

export type PssCheckDoc = {
  title: string;
  why: string;
  fix: string;
  docUrl: string;
};

const RBAC_GOOD_PRACTICES = "https://kubernetes.io/docs/concepts/security/rbac-good-practices/";

/**
 * Keyed by the `rule` field on an RbacRiskFinding. When a new risk pattern is
 * added to the scanner, a matching entry here keeps the UI consistent.
 */
export const RBAC_RULE_CATALOG: Record<string, RbacRuleDoc> = {
  "wildcard-all": {
    title: "Wildcard verbs on wildcard resources",
    why: "Grants unrestricted access to every current and future resource - equivalent to cluster-admin.",
    fix: "Replace `*` with explicit verbs (get/list/watch) and explicit resources. If a role truly needs cluster-admin, bind cluster-admin directly and audit usage.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "wildcard-resources": {
    title: "Wildcard resources",
    why: "Future resource types added by a CRD or K8s upgrade are automatically granted, silently widening access.",
    fix: "List each resource by name. Accept the maintenance cost - it is the point of least-privilege.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "escalate-roles": {
    title: "escalate verb on roles/clusterroles",
    why: "Allows creating or modifying roles with more privilege than the holder already has, bypassing the normal escalation prevention.",
    fix: "Remove the escalate verb. If a controller truly needs to manage roles, scope it to specific names with resourceNames.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "bind-rolebindings": {
    title: "bind verb on (cluster)rolebindings",
    why: "Allows binding any elevated role to a user or service account, including cluster-admin.",
    fix: "Remove the bind verb. Use dedicated controllers with narrower permissions or manage bindings via GitOps.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "impersonate-users": {
    title: "impersonate verb",
    why: "Lets the holder act as any user, group, or service account - including cluster-admin.",
    fix: "Remove impersonate. If an integration genuinely needs it (e.g. kubectl auth can-i --as), scope it to specific users with resourceNames.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "nodes-proxy": {
    title: "Access to nodes/proxy",
    why: "Enables direct calls to the Kubelet API, bypassing audit logging and admission control.",
    fix: "Remove nodes/proxy. Use kubectl exec / metrics-server / Prometheus node-exporter instead for the typical use cases.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "secrets-list-watch": {
    title: "list/watch on secrets",
    why: "The response body contains secret values in full, not just metadata. Any holder sees every credential in scope.",
    fix: "Replace with get on specific resourceNames. If watching is required, use a CSI secrets driver or a dedicated controller with its own SA.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "pods-exec": {
    title: "create on pods/exec",
    why: "Allows executing arbitrary commands inside any container in scope - effectively a remote shell.",
    fix: "Restrict to specific pod names via resourceNames. Prefer ephemeral containers with kubectl debug for short-lived troubleshooting.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "pv-create": {
    title: "create on persistentvolumes",
    why: "PersistentVolumes can mount hostPath, reading/writing anywhere on the node filesystem and bypassing container isolation.",
    fix: "Grant create on persistentvolumeclaims only. Admins create PVs out-of-band or via a CSI driver.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "sa-token-create": {
    title: "create on serviceaccounts/token",
    why: "Allows minting tokens for any service account in scope, including high-privilege controller SAs.",
    fix: "Use projected volumes (automatic, scoped to a single pod) or bound service account tokens. Avoid manual token minting.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "webhook-modify": {
    title: "Mutating/validating admission webhooks",
    why: "Admission webhooks implement security policy. Modifying them can disable PSS, OPA/Gatekeeper, Kyverno, etc.",
    fix: "Restrict to specific webhook names via resourceNames. Manage webhook CRs via GitOps so changes require review.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "pods-create": {
    title: "create on pods",
    why: "A new pod can mount any secret, configmap, or service account token in the namespace - that is not recorded as a direct read permission.",
    fix: "Prefer controllers (Deployment, Job) over direct pod creation and scope workload service accounts tightly. Use PSS to limit what a created pod can request.",
    docUrl: RBAC_GOOD_PRACTICES,
  },
  "namespace-update": {
    title: "update/patch on namespaces",
    why: "Namespace labels carry Pod Security Standards enforcement levels. Changing labels silently relaxes pod-level policy.",
    fix: "Split namespace creation from pod deployment rights. Manage namespaces via GitOps and gate label changes with Kyverno/OPA.",
    docUrl: "https://kubernetes.io/docs/concepts/security/pod-security-admission/",
  },
};

const PSS_DOC = "https://kubernetes.io/docs/concepts/security/pod-security-standards/";

/**
 * Keyed by the `check` field on a PssViolation. Covers every check emitted
 * by `pss-compliance.ts`. Must stay in sync with the scanner - the contract
 * test in rule-catalog.test.ts enforces that.
 */
export const PSS_CHECK_CATALOG: Record<string, PssCheckDoc> = {
  "host-namespaces": {
    title: "Host namespaces",
    why: "hostNetwork, hostPID, or hostIPC break the pod boundary: processes see node-level network/PID/IPC and can interfere with or observe other workloads.",
    fix: "Remove the host* flags from the pod spec. If a workload genuinely needs them, run it in a dedicated node pool with a restrictive PSS level.",
    docUrl: PSS_DOC,
  },
  "host-path-volumes": {
    title: "hostPath volumes",
    why: "hostPath mounts anywhere on the node disk, including /etc, /var/run/docker.sock, kubelet certificates.",
    fix: "Switch to persistentVolumeClaim, configMap, or secret volumes. When hostPath is truly required (CSI, monitoring agent), scope the path and mount readOnly.",
    docUrl: PSS_DOC,
  },
  privileged: {
    title: "Privileged container",
    why: "A privileged container disables almost every security mechanism: the host device tree is exposed, capabilities are uncapped, AppArmor and SELinux are bypassed.",
    fix: "Remove securityContext.privileged. If device access is needed, grant specific Linux capabilities plus a device plugin instead.",
    docUrl: PSS_DOC,
  },
  capabilities: {
    title: "Baseline capabilities",
    why: "Baseline forbids capabilities outside a short allowed list (AUDIT_WRITE, CHOWN, DAC_OVERRIDE, FOWNER, KILL, MKNOD, NET_BIND_SERVICE, SETFCAP, SETGID, SETPCAP, SETUID, SYS_CHROOT).",
    fix: "Remove the added capability or move the workload to a dedicated privileged namespace with a stricter overall PSS policy.",
    docUrl: PSS_DOC,
  },
  seccomp: {
    title: "Seccomp profile",
    why: "Seccomp filters dangerous syscalls. Unconfined leaves the kernel attack surface wide open.",
    fix: "Set seccompProfile.type: RuntimeDefault at the pod level. Use Localhost profiles only when you have a workload-specific profile file.",
    docUrl: PSS_DOC,
  },
  "host-ports": {
    title: "Host ports",
    why: "A hostPort binds the node's external interface, colliding with other pods on the same node and exposing the container without a Service abstraction.",
    fix: "Use a Service (ClusterIP, NodePort, LoadBalancer) or an Ingress instead of hostPort.",
    docUrl: PSS_DOC,
  },
  "run-as-non-root": {
    title: "runAsNonRoot",
    why: "Restricted requires pods to declare they run as a non-root UID. Running as root is one of the most common escalation paths when combined with a volume bug.",
    fix: "Set runAsNonRoot: true and runAsUser >= 1000 on the pod or each container. Rebuild images that hard-require root using a distroless or chainguard base.",
    docUrl: PSS_DOC,
  },
  "drop-all-capabilities": {
    title: "Drop ALL capabilities",
    why: "Restricted requires dropping the full Linux capability set and only re-adding NET_BIND_SERVICE when strictly needed.",
    fix: "capabilities.drop: [ALL]. Only add NET_BIND_SERVICE when the workload must bind :80 or :443 without a reverse proxy.",
    docUrl: PSS_DOC,
  },
  "privilege-escalation": {
    title: "allowPrivilegeEscalation",
    why: "Leaving this unset defaults to true in many environments, letting setuid binaries escalate to root even from a non-root runtime.",
    fix: "Set allowPrivilegeEscalation: false on every container.",
    docUrl: PSS_DOC,
  },
  "seccomp-restricted": {
    title: "Restricted seccomp",
    why: "Restricted demands a non-Unconfined seccomp profile. Unset or Unconfined fails the policy.",
    fix: "Set spec.securityContext.seccompProfile.type: RuntimeDefault (applies to every container). Localhost profiles are fine if you own them.",
    docUrl: PSS_DOC,
  },
};

/**
 * Shown at the top of the RBAC section so users can see what the scanner
 * covers without expanding individual findings.
 */
export const RBAC_SCAN_OVERVIEW = {
  summary:
    "RBAC least-privilege scan. Flags verb + resource combinations that widen the blast radius of a compromised role, based on the upstream RBAC good-practices guide.",
  rulesCount: Object.keys(RBAC_RULE_CATALOG).length,
  docUrl: RBAC_GOOD_PRACTICES,
};

export const PSS_SCAN_OVERVIEW = {
  summary:
    "Pod Security Standards compliance. Each pod is tested against the Baseline and Restricted policies from upstream Kubernetes.",
  docUrl: PSS_DOC,
};
