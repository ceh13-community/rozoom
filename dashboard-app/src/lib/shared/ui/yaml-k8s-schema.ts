/**
 * Kubernetes field documentation and schema utilities.
 *
 * Provides hover tooltip documentation for known K8s fields
 * and schema-aware completion support.
 */

/**
 * Documentation for common Kubernetes fields.
 * Used by hover tooltips and completion detail.
 */
export const K8S_FIELD_DOCS: Record<string, string> = {
  // Top-level
  apiVersion: "API version defining the versioned schema of this object (e.g. apps/v1, v1)",
  kind: "Type of Kubernetes resource (e.g. Deployment, Service, Pod)",
  metadata: "Standard object metadata including name, namespace, labels, and annotations",
  spec: "Specification of the desired behavior of the resource",
  status: "Most recently observed status of the resource (usually read-only)",

  // Metadata
  name: "Name must be unique within a namespace. Required for most resources",
  namespace: "Namespace defines the space within which each name must be unique",
  labels: "Map of key-value pairs for organizing and selecting resources",
  annotations: "Unstructured key-value data for storing arbitrary non-identifying metadata",
  generateName:
    "Optional prefix used by the server to generate a unique name if name is not provided",
  finalizers: "List of finalizers that must be empty before the object is deleted",
  ownerReferences:
    "List of objects depended by this object. If all are deleted, this object will be garbage collected",
  resourceVersion:
    "Opaque value representing the internal version, used for optimistic concurrency",
  uid: "Unique identifier assigned by the system. Each object has a distinct UID across space and time",
  creationTimestamp: "Timestamp representing the server time when this object was created",

  // Pod spec
  containers: "List of containers belonging to the pod. At least one container must be specified",
  initContainers:
    "List of initialization containers. Executed in order before app containers start",
  volumes: "List of volumes that can be mounted by containers in this pod",
  serviceAccountName: "Name of the ServiceAccount to use to run this pod",
  nodeSelector:
    "Selector which must match a node's labels for the pod to be scheduled on that node",
  tolerations:
    "If specified, the pod's tolerations. Allows scheduling onto nodes with matching taints",
  affinity: "Scheduling constraints: nodeAffinity, podAffinity, and podAntiAffinity",
  restartPolicy:
    "Restart policy for all containers. One of Always, OnFailure, Never. Default: Always",
  terminationGracePeriodSeconds:
    "Duration in seconds the pod needs to terminate gracefully (default 30)",
  dnsPolicy:
    "Set DNS policy for the pod. One of ClusterFirstWithHostNet, ClusterFirst, Default, None",
  hostNetwork: "Use the host's network namespace. If true, ports will be exposed on the host",
  securityContext: "Pod-level or container-level security attributes and common container settings",
  imagePullSecrets: "List of references to secrets for pulling any of the images used by this pod",
  priorityClassName:
    "Priority class name. If specified, indicates the pod's priority for scheduling",

  // Container spec
  image: "Container image name in format [registry/]repository[:tag|@digest]",
  imagePullPolicy: "Image pull policy. One of Always, Never, IfNotPresent. Default varies by tag",
  command: "Entrypoint array. Replaces the container image's ENTRYPOINT",
  args: "Arguments to the entrypoint. Replaces the container image's CMD",
  ports: "List of ports to expose from the container",
  env: "List of environment variables to set in the container",
  envFrom: "List of sources to populate environment variables (ConfigMaps, Secrets)",
  resources: "Compute resources required by this container (CPU, memory requests and limits)",
  volumeMounts: "Pod volumes to mount into the container's filesystem",
  livenessProbe:
    "Periodic probe of container liveness. Container will be restarted if the probe fails",
  readinessProbe:
    "Periodic probe of container readiness. Container will be removed from service if probe fails",
  startupProbe: "Startup probe. Container is not considered ready until this probe succeeds",
  lifecycle:
    "Actions that the management system should take in response to container lifecycle events",
  workingDir:
    "Container's working directory. If not specified, the container runtime's default is used",
  containerPort: "Number of port to expose on the pod's IP address. Must be 1-65535",

  // Resources
  requests: "Minimum amount of compute resources required. Scheduler uses this to find a node",
  limits:
    "Maximum amount of compute resources allowed. Container is killed if it exceeds memory limit",
  cpu: "CPU resource in cores (1 = 1 vCPU). Fractional values allowed (e.g. 100m = 0.1 core)",
  memory: "Memory resource in bytes. Use suffixes: Ki, Mi, Gi (e.g. 128Mi, 1Gi)",

  // Workload spec
  replicas: "Number of desired pods. Defaults to 1",
  selector:
    "Label selector for pods. Existing ReplicaSets whose pods match this will be scaled down",
  template: "Describes the pod that will be created. Required for workload resources",
  strategy: "Deployment strategy to use. RollingUpdate (default) or Recreate",
  minReadySeconds: "Minimum seconds for a newly created pod to be available (default 0)",
  revisionHistoryLimit: "Number of old ReplicaSets to retain for rollback (default 10)",
  progressDeadlineSeconds:
    "Maximum time for a deployment to make progress before it's considered failed",

  // Service spec
  type: "Determines how the Service is exposed. ClusterIP (default), NodePort, LoadBalancer, ExternalName",
  clusterIP:
    "IP address of the service. Usually assigned by the system. Set to None for headless services",
  externalTrafficPolicy:
    "Controls if traffic from external sources is routed to node-local or cluster-wide endpoints",
  sessionAffinity: "Enable client IP based session affinity. One of ClientIP or None (default)",
  loadBalancerIP: "IP to use when creating a LoadBalancer service (platform dependent)",
  loadBalancerSourceRanges:
    "Restrict traffic to LoadBalancer to specified client IPs (CIDR ranges)",

  // Ingress spec
  ingressClassName: "Name of the IngressClass to use for this Ingress resource",
  tls: "TLS configuration. Each entry specifies hosts and a secret containing the certificate",
  rules:
    "List of host rules used to configure the Ingress. If empty, all traffic is sent to defaultBackend",
  defaultBackend: "Backend that handles requests that don't match any rule",

  // Common nested
  matchLabels:
    "Map of key-value pairs. A single {key: value} is equivalent to labelSelector requirement",
  protocol: "Protocol for the port. Must be UDP, TCP, or SCTP. Defaults to TCP",
  targetPort: "Number or name of the port to access on the pods targeted by the service",
  nodePort:
    "Port on each node on which this service is exposed when type is NodePort or LoadBalancer",
  path: "Path to access on the HTTP server for health check probes",
  host: "Hostname for Ingress rule routing. If not specified, rule applies to all inbound traffic",

  // Probes
  httpGet: "HTTP GET action. The probe succeeds if the response status code is >= 200 and < 400",
  tcpSocket: "TCP socket action. Port number check. Probe succeeds if the port is open",
  exec: "Exec action. Probe succeeds if the command exits with status code 0",
  initialDelaySeconds: "Seconds after container starts before probe is initiated (default 0)",
  periodSeconds: "How often (in seconds) to perform the probe (default 10)",
  timeoutSeconds: "Number of seconds after which the probe times out (default 1)",
  successThreshold:
    "Minimum consecutive successes for the probe to be considered successful (default 1)",
  failureThreshold:
    "Minimum consecutive failures for the probe to be considered failed (default 3)",

  // Security
  runAsNonRoot: "Indicates that the container must run as a non-root user",
  runAsUser: "The UID to run the entrypoint of the container process",
  runAsGroup: "The GID to run the entrypoint of the container process",
  fsGroup: "A special supplemental group applied to all containers in a pod",
  allowPrivilegeEscalation:
    "Controls whether a process can gain more privileges than its parent process",
  capabilities: "POSIX capabilities to add or drop from the container",
  readOnlyRootFilesystem: "Whether the container's root filesystem is mounted as read-only",
  privileged: "Run container in privileged mode. Gives all capabilities to the container",
  seccompProfile: "Seccomp profile settings for a container or pod",

  // Volume types
  emptyDir: "Temporary directory that shares a pod's lifetime. Initially empty",
  configMap: "Populates a volume with data from a ConfigMap",
  secret: "Populates a volume with data from a Secret",
  persistentVolumeClaim: "References a PersistentVolumeClaim in the same namespace",
  hostPath: "Mounts a file or directory from the host node's filesystem into the pod",
  mountPath: "Path within the container at which the volume should be mounted",
  subPath: "Sub-path inside the referenced volume instead of its root",
  readOnly: "Mounted read-only if true, read-write otherwise (default false)",
};

/**
 * Get documentation for a YAML field, considering the full path context.
 * Returns null if no documentation is available.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getFieldDoc(fieldName: string, _pathContext?: string[]): string | null {
  return K8S_FIELD_DOCS[fieldName] || null;
}

/**
 * Get the field name from a YAML line at a given position.
 */
export function extractFieldAtPosition(line: string): string | null {
  // Match "key:" or "- key:" patterns
  const match = line.match(/^\s*-?\s*([\w./$@~-]+)\s*:/);
  return match ? match[1] : null;
}
