import { kubectlRawArgsFront, kubectlRawFront } from "$shared/api/kubectl-proxy";

export type OverviewAccessCapabilityStatus = "allowed" | "denied" | "unknown";

export type OverviewAccessCapability = {
  id:
    | "pods_read"
    | "events_read"
    | "nodes_read"
    | "secrets_read"
    | "logs"
    | "exec"
    | "portforward"
    | "kube_system_read";
  title: string;
  status: OverviewAccessCapabilityStatus;
  detail: string;
};

export type OverviewAccessProfile = {
  subject: string;
  subjectSource: "auth_whoami" | "kubeconfig" | "unknown";
  contextName?: string;
  namespace: string;
  capabilities: OverviewAccessCapability[];
  diagnosticsImpact: string[];
  updatedAt: number;
  error?: string;
};

type CanICheck = {
  id: OverviewAccessCapability["id"];
  title: string;
  args: string[];
  allowedDetail: string;
  deniedDetail: string;
};

type KubeconfigView = {
  "current-context"?: string;
  contexts?: Array<{ name?: string; context?: { user?: string; namespace?: string } }>;
};

const CAN_I_CHECKS: CanICheck[] = [
  {
    id: "pods_read",
    title: "Pods",
    args: ["auth", "can-i", "list", "pods", "--all-namespaces"],
    allowedDetail: "Can read pod inventory across namespaces.",
    deniedDetail: "Pod listing is restricted.",
  },
  {
    id: "events_read",
    title: "Events",
    args: ["auth", "can-i", "list", "events", "--all-namespaces"],
    allowedDetail: "Can read warning and lifecycle events.",
    deniedDetail: "Event visibility is restricted.",
  },
  {
    id: "nodes_read",
    title: "Nodes",
    args: ["auth", "can-i", "list", "nodes"],
    allowedDetail: "Can inspect node health and pressure.",
    deniedDetail: "Node visibility is restricted.",
  },
  {
    id: "secrets_read",
    title: "Secrets",
    args: ["auth", "can-i", "get", "secrets", "-n", "kube-system"],
    allowedDetail: "Can inspect secrets in kube-system.",
    deniedDetail: "Secrets access is restricted.",
  },
  {
    id: "logs",
    title: "Logs",
    args: ["auth", "can-i", "get", "pods", "-n", "default", "--subresource", "log"],
    allowedDetail: "Can read pod logs.",
    deniedDetail: "Pod log access is restricted.",
  },
  {
    id: "exec",
    title: "Exec",
    args: ["auth", "can-i", "create", "pods", "-n", "default", "--subresource", "exec"],
    allowedDetail: "Can start exec sessions into pods.",
    deniedDetail: "Pod exec access is restricted.",
  },
  {
    id: "portforward",
    title: "Port-forward",
    args: ["auth", "can-i", "create", "pods", "-n", "default", "--subresource", "portforward"],
    allowedDetail: "Can open pod port-forward sessions.",
    deniedDetail: "Port-forward access is restricted.",
  },
  {
    id: "kube_system_read",
    title: "kube-system",
    args: ["auth", "can-i", "list", "pods", "-n", "kube-system"],
    allowedDetail: "Can inspect kube-system pods.",
    deniedDetail: "kube-system pod access is restricted.",
  },
];

function normalizeCanIStatus(
  output: string,
  errors: string,
  code?: number,
): OverviewAccessCapabilityStatus {
  if (errors || code !== 0) return "unknown";
  const normalized = output.trim().toLowerCase();
  if (normalized === "yes") return "allowed";
  if (normalized === "no") return "denied";
  return "unknown";
}

function buildDiagnosticsImpact(capabilities: OverviewAccessCapability[]): string[] {
  const byId = new Map(capabilities.map((item) => [item.id, item]));
  const impacts: string[] = [];

  if (byId.get("nodes_read")?.status !== "allowed") {
    impacts.push("Node readiness, pressure, and capacity diagnostics may be limited by RBAC.");
  }
  if (byId.get("events_read")?.status !== "allowed") {
    impacts.push("Warning events and change detection may be incomplete.");
  }
  if (byId.get("kube_system_read")?.status !== "allowed") {
    impacts.push("Control-plane pod fallback and kube-system inspection may be unavailable.");
  }
  if (byId.get("secrets_read")?.status !== "allowed") {
    impacts.push("Secrets hygiene and some certificate-related diagnostics may be limited.");
  }
  if (byId.get("logs")?.status !== "allowed" || byId.get("exec")?.status !== "allowed") {
    impacts.push("Interactive troubleshooting actions like logs or exec are partially restricted.");
  }

  return impacts;
}

async function resolveSubject(clusterId: string): Promise<{
  subject: string;
  subjectSource: OverviewAccessProfile["subjectSource"];
  contextName?: string;
  namespace: string;
}> {
  const [whoamiResult, configViewResult] = await Promise.all([
    kubectlRawArgsFront(["auth", "whoami"], { clusterId, allowCommandUnavailable: true }),
    kubectlRawFront("config view --minify -o json", { clusterId }),
  ]);

  let contextName: string | undefined;
  let namespace = "default";
  let kubeconfigUser: string | undefined;

  if (configViewResult.output) {
    try {
      const parsed = JSON.parse(configViewResult.output) as KubeconfigView;
      contextName = parsed["current-context"];
      const context =
        parsed.contexts?.find((item) => item.name === contextName) ?? parsed.contexts?.[0];
      kubeconfigUser = context?.context?.user;
      namespace = context?.context?.namespace || "default";
    } catch {
      // ignore malformed kubeconfig output
    }
  }

  const whoamiOutput = whoamiResult.output.trim();
  if (whoamiOutput && !whoamiResult.errors) {
    const subject = whoamiOutput.split("\n")[0]?.trim();
    if (subject) {
      return {
        subject,
        subjectSource: "auth_whoami",
        contextName,
        namespace,
      };
    }
  }

  if (kubeconfigUser) {
    return {
      subject: kubeconfigUser,
      subjectSource: "kubeconfig",
      contextName,
      namespace,
    };
  }

  return {
    subject: "Unknown user",
    subjectSource: "unknown",
    contextName,
    namespace,
  };
}

export async function fetchOverviewAccessProfile(
  clusterId: string,
): Promise<OverviewAccessProfile> {
  const identity = await resolveSubject(clusterId);
  const capabilityResults = await Promise.all(
    CAN_I_CHECKS.map(async (check) => {
      const response = await kubectlRawArgsFront(check.args, {
        clusterId,
        allowCommandUnavailable: true,
      });
      const status = normalizeCanIStatus(response.output, response.errors, response.code);
      return {
        id: check.id,
        title: check.title,
        status,
        detail:
          status === "allowed"
            ? check.allowedDetail
            : status === "denied"
              ? check.deniedDetail
              : "Could not determine access from kubectl auth can-i.",
      } satisfies OverviewAccessCapability;
    }),
  );

  return {
    subject: identity.subject,
    subjectSource: identity.subjectSource,
    contextName: identity.contextName,
    namespace: identity.namespace,
    capabilities: capabilityResults,
    diagnosticsImpact: buildDiagnosticsImpact(capabilityResults),
    updatedAt: Date.now(),
  };
}
