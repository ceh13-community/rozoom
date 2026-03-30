/**
 * Pod Security Standards compliance checker.
 *
 * Based on: https://kubernetes.io/docs/concepts/security/pod-security-standards/
 *
 * Three levels:
 *   - Privileged: unrestricted (no checks)
 *   - Baseline: prevent known privilege escalations
 *   - Restricted: hardened best practices (superset of Baseline)
 */

export type PssLevel = "privileged" | "baseline" | "restricted";

export type PssViolation = {
  level: PssLevel;
  field: string;
  check: string;
  message: string;
};

export type PssPodResult = {
  namespace: string;
  pod: string;
  violations: PssViolation[];
  maxCompliantLevel: PssLevel;
};

export type PssReport = {
  pods: PssPodResult[];
  summary: {
    total: number;
    restrictedCompliant: number;
    baselineCompliant: number;
    privilegedOnly: number;
  };
};

type SecurityContextInput = {
  privileged?: boolean;
  runAsNonRoot?: boolean;
  runAsUser?: number;
  readOnlyRootFilesystem?: boolean;
  allowPrivilegeEscalation?: boolean;
  capabilities?: { add?: string[]; drop?: string[] };
  seccompProfile?: { type?: string };
};

type ContainerInput = {
  name: string;
  securityContext?: SecurityContextInput;
  ports?: Array<{ hostPort?: number }>;
};

type PodInput = {
  namespace: string;
  pod: string;
  hostNetwork?: boolean;
  hostPID?: boolean;
  hostIPC?: boolean;
  volumes?: Array<{ hostPath?: { path: string } }>;
  securityContext?: SecurityContextInput;
  containers: ContainerInput[];
  initContainers?: ContainerInput[];
  ephemeralContainers?: ContainerInput[];
};

function allContainers(pod: PodInput): ContainerInput[] {
  return [...pod.containers, ...(pod.initContainers ?? []), ...(pod.ephemeralContainers ?? [])];
}

function checkBaseline(pod: PodInput): PssViolation[] {
  const violations: PssViolation[] = [];

  // spec.hostNetwork
  if (pod.hostNetwork) {
    violations.push({
      level: "baseline",
      field: "spec.hostNetwork",
      check: "host-namespaces",
      message: "hostNetwork must be false",
    });
  }
  // spec.hostPID
  if (pod.hostPID) {
    violations.push({
      level: "baseline",
      field: "spec.hostPID",
      check: "host-namespaces",
      message: "hostPID must be false",
    });
  }
  // spec.hostIPC
  if (pod.hostIPC) {
    violations.push({
      level: "baseline",
      field: "spec.hostIPC",
      check: "host-namespaces",
      message: "hostIPC must be false",
    });
  }
  // hostPath volumes
  const hostPaths = pod.volumes?.filter((v) => v.hostPath) ?? [];
  if (hostPaths.length > 0) {
    violations.push({
      level: "baseline",
      field: "spec.volumes[*].hostPath",
      check: "host-path-volumes",
      message: "hostPath volumes are not allowed",
    });
  }

  // Pod-level seccomp Unconfined (Baseline)
  if (pod.securityContext?.seccompProfile?.type === "Unconfined") {
    violations.push({
      level: "baseline",
      field: "spec.securityContext.seccompProfile.type",
      check: "seccomp",
      message: "Seccomp profile must not be Unconfined",
    });
  }

  for (const c of allContainers(pod)) {
    const sc = c.securityContext;
    // privileged containers
    if (sc?.privileged) {
      violations.push({
        level: "baseline",
        field: `containers[${c.name}].securityContext.privileged`,
        check: "privileged",
        message: "Privileged containers are not allowed",
      });
    }
    // host ports
    const hostPorts = c.ports?.filter((p) => p.hostPort && p.hostPort !== 0) ?? [];
    if (hostPorts.length > 0) {
      violations.push({
        level: "baseline",
        field: `containers[${c.name}].ports[*].hostPort`,
        check: "host-ports",
        message: "Host ports are not allowed",
      });
    }
    // dangerous capabilities
    const dangerousCaps = (sc?.capabilities?.add ?? []).filter(
      (cap) => !ALLOWED_BASELINE_CAPS.has(cap.toUpperCase()),
    );
    if (dangerousCaps.length > 0) {
      violations.push({
        level: "baseline",
        field: `containers[${c.name}].securityContext.capabilities.add`,
        check: "capabilities",
        message: `Dangerous capabilities: ${dangerousCaps.join(", ")}`,
      });
    }
    // seccomp Unconfined
    if (sc?.seccompProfile?.type === "Unconfined") {
      violations.push({
        level: "baseline",
        field: `containers[${c.name}].securityContext.seccompProfile.type`,
        check: "seccomp",
        message: "Seccomp profile must not be Unconfined",
      });
    }
  }

  return violations;
}

function checkRestricted(pod: PodInput): PssViolation[] {
  const violations: PssViolation[] = [];

  // Pod-level runAsNonRoot
  const podRunAsNonRoot = pod.securityContext?.runAsNonRoot;

  for (const c of allContainers(pod)) {
    const sc = c.securityContext;

    // runAsNonRoot
    if (!sc?.runAsNonRoot && !podRunAsNonRoot) {
      violations.push({
        level: "restricted",
        field: `containers[${c.name}].securityContext.runAsNonRoot`,
        check: "run-as-non-root",
        message: "runAsNonRoot must be true",
      });
    }
    // drop ALL capabilities
    const dropped = sc?.capabilities?.drop?.map((c) => c.toUpperCase()) ?? [];
    if (!dropped.includes("ALL")) {
      violations.push({
        level: "restricted",
        field: `containers[${c.name}].securityContext.capabilities.drop`,
        check: "drop-all-capabilities",
        message: "Must drop ALL capabilities",
      });
    }
    // allowPrivilegeEscalation
    if (sc?.allowPrivilegeEscalation !== false) {
      violations.push({
        level: "restricted",
        field: `containers[${c.name}].securityContext.allowPrivilegeEscalation`,
        check: "privilege-escalation",
        message: "allowPrivilegeEscalation must be false",
      });
    }
    // seccomp profile
    const seccomp = sc?.seccompProfile?.type ?? pod.securityContext?.seccompProfile?.type;
    if (seccomp !== "RuntimeDefault" && seccomp !== "Localhost") {
      violations.push({
        level: "restricted",
        field: `containers[${c.name}].securityContext.seccompProfile.type`,
        check: "seccomp-restricted",
        message: "seccompProfile must be RuntimeDefault or Localhost",
      });
    }
  }

  return violations;
}

// Capabilities allowed at Baseline level per PSS spec
const ALLOWED_BASELINE_CAPS = new Set([
  "AUDIT_WRITE",
  "CHOWN",
  "DAC_OVERRIDE",
  "FOWNER",
  "FSETID",
  "KILL",
  "MKNOD",
  "NET_BIND_SERVICE",
  "SETFCAP",
  "SETGID",
  "SETPCAP",
  "SETUID",
  "SYS_CHROOT",
]);

function deriveMaxLevel(
  baselineViolations: PssViolation[],
  restrictedViolations: PssViolation[],
): PssLevel {
  if (baselineViolations.length > 0) return "privileged";
  if (restrictedViolations.length > 0) return "baseline";
  return "restricted";
}

export function checkPodCompliance(pod: PodInput): PssPodResult {
  const baselineViolations = checkBaseline(pod);
  const restrictedViolations = checkRestricted(pod);
  const allViolations = [...baselineViolations, ...restrictedViolations];

  return {
    namespace: pod.namespace,
    pod: pod.pod,
    violations: allViolations,
    maxCompliantLevel: deriveMaxLevel(baselineViolations, restrictedViolations),
  };
}

export function buildPssReport(pods: PodInput[]): PssReport {
  const results = pods.map(checkPodCompliance);

  return {
    pods: results,
    summary: {
      total: results.length,
      restrictedCompliant: results.filter((r) => r.maxCompliantLevel === "restricted").length,
      baselineCompliant: results.filter((r) => r.maxCompliantLevel === "baseline").length,
      privilegedOnly: results.filter((r) => r.maxCompliantLevel === "privileged").length,
    },
  };
}
