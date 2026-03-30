export type FixTemplateId =
  | "pdb"
  | "network-policy-default-deny"
  | "resource-quota"
  | "limit-range"
  | "readiness-probe"
  | "liveness-probe"
  | "security-context";

export type FixTemplate = {
  id: FixTemplateId;
  title: string;
  description: string;
  category: string;
  generate: (params: TemplateParams) => string;
};

export type TemplateParams = {
  namespace: string;
  name?: string;
  labels?: Record<string, string>;
  replicas?: number;
  port?: number;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
};

function labelSelector(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([k, v]) => `      ${k}: "${v}"`)
    .join("\n");
}

const TEMPLATES: FixTemplate[] = [
  {
    id: "pdb",
    title: "PodDisruptionBudget",
    description:
      "Protect workload availability during voluntary disruptions (node drains, upgrades).",
    category: "High Availability",
    generate: (params) => {
      const name = params.name ?? "my-workload";
      const labels = params.labels ?? { app: name };
      return `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ${name}-pdb
  namespace: ${params.namespace}
spec:
  minAvailable: 1
  selector:
    matchLabels:
${labelSelector(labels)}`;
    },
  },
  {
    id: "network-policy-default-deny",
    title: "Default-Deny NetworkPolicy",
    description:
      "Block all ingress/egress traffic by default, then allow DNS. Zero-trust baseline.",
    category: "Security",
    generate: (params) => `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: ${params.namespace}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  egress:
    - to: []
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53`,
  },
  {
    id: "resource-quota",
    title: "ResourceQuota",
    description: "Limit total CPU/memory consumption in a namespace to prevent noisy neighbors.",
    category: "Capacity",
    generate: (params) => `apiVersion: v1
kind: ResourceQuota
metadata:
  name: ${params.namespace}-quota
  namespace: ${params.namespace}
spec:
  hard:
    requests.cpu: "${params.cpuRequest ?? "4"}"
    requests.memory: "${params.memoryRequest ?? "8Gi"}"
    limits.cpu: "${params.cpuLimit ?? "8"}"
    limits.memory: "${params.memoryLimit ?? "16Gi"}"
    pods: "50"`,
  },
  {
    id: "limit-range",
    title: "LimitRange",
    description:
      "Set default CPU/memory requests and limits for containers without explicit resource specs.",
    category: "Capacity",
    generate: (params) => `apiVersion: v1
kind: LimitRange
metadata:
  name: ${params.namespace}-limits
  namespace: ${params.namespace}
spec:
  limits:
    - default:
        cpu: "${params.cpuLimit ?? "500m"}"
        memory: "${params.memoryLimit ?? "512Mi"}"
      defaultRequest:
        cpu: "${params.cpuRequest ?? "100m"}"
        memory: "${params.memoryRequest ?? "128Mi"}"
      type: Container`,
  },
  {
    id: "readiness-probe",
    title: "Readiness Probe",
    description:
      "Check if the container is ready to serve traffic. Prevents routing to unready pods.",
    category: "Health Checks",
    generate: (params) => {
      const port = params.port ?? 8080;
      return `readinessProbe:
  httpGet:
    path: /healthz
    port: ${port}
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3`;
    },
  },
  {
    id: "liveness-probe",
    title: "Liveness Probe",
    description: "Detect deadlocked containers and restart them automatically.",
    category: "Health Checks",
    generate: (params) => {
      const port = params.port ?? 8080;
      return `livenessProbe:
  httpGet:
    path: /healthz
    port: ${port}
  initialDelaySeconds: 15
  periodSeconds: 20
  timeoutSeconds: 5
  failureThreshold: 3`;
    },
  },
  {
    id: "security-context",
    title: "Security Context",
    description: "Harden pod security: non-root, read-only filesystem, drop capabilities.",
    category: "Security",
    generate: () => `securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL`,
  },
];

export function getFixTemplates(): FixTemplate[] {
  return TEMPLATES;
}

export function getFixTemplate(id: FixTemplateId): FixTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function generateFix(id: FixTemplateId, params: TemplateParams): string | null {
  const template = getFixTemplate(id);
  if (!template) return null;
  return template.generate(params);
}

export function getTemplatesByCategory(): Record<string, FixTemplate[]> {
  const result: Record<string, FixTemplate[]> = {};
  for (const t of TEMPLATES) {
    (result[t.category] ??= []).push(t);
  }
  return result;
}
