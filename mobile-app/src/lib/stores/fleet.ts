import { writable } from "svelte/store";

export type ClusterStatus = "healthy" | "warning" | "critical";

export interface ClusterSummary {
  id: string;
  name: string;
  provider: string;
  region: string;
  cloud: string;
  score: number;
  status: ClusterStatus;
  nodes: number;
  pods: number;
  deploys: number;
  running: number;
  pending: number;
  failed: number;
}

export interface Alert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  cluster: string;
  namespace: string;
  age: string;
}

export function scoreToStatus(score: number): ClusterStatus {
  if (score >= 80) return "healthy";
  if (score >= 50) return "warning";
  return "critical";
}

// Demo data - will be replaced by K8s API calls
const DEMO_CLUSTERS: ClusterSummary[] = [
  {
    id: "prod-eu",
    name: "prod-eu-west-1",
    provider: "EKS",
    region: "eu-west-1",
    cloud: "AWS",
    score: 92,
    status: "healthy",
    nodes: 12,
    pods: 148,
    deploys: 24,
    running: 142,
    pending: 4,
    failed: 2,
  },
  {
    id: "staging-us",
    name: "staging-us-east",
    provider: "GKE",
    region: "us-east1",
    cloud: "GCP",
    score: 74,
    status: "warning",
    nodes: 6,
    pods: 89,
    deploys: 15,
    running: 81,
    pending: 6,
    failed: 2,
  },
  {
    id: "dev-do",
    name: "dev-digitalocean",
    provider: "DOKS",
    region: "fra1",
    cloud: "DigitalOcean",
    score: 38,
    status: "critical",
    nodes: 3,
    pods: 42,
    deploys: 8,
    running: 30,
    pending: 5,
    failed: 7,
  },
  {
    id: "prod-hetzner",
    name: "prod-hetzner-fsn1",
    provider: "K3s",
    region: "fsn1",
    cloud: "Hetzner",
    score: 88,
    status: "healthy",
    nodes: 5,
    pods: 67,
    deploys: 12,
    running: 64,
    pending: 2,
    failed: 1,
  },
  {
    id: "prod-aks",
    name: "prod-aks-westeurope",
    provider: "AKS",
    region: "westeurope",
    cloud: "Azure",
    score: 95,
    status: "healthy",
    nodes: 8,
    pods: 112,
    deploys: 19,
    running: 110,
    pending: 1,
    failed: 1,
  },
];

const DEMO_ALERTS: Alert[] = [
  {
    id: "a1",
    severity: "critical",
    title: "CrashLoopBackOff",
    description: "cronjob-data-sync-28f4d has restarted 14 times in the last hour",
    cluster: "dev-digitalocean",
    namespace: "default",
    age: "2 min ago",
  },
  {
    id: "a2",
    severity: "critical",
    title: "Node NotReady",
    description: "Node worker-3 is in NotReady state, 12 pods affected",
    cluster: "dev-digitalocean",
    namespace: "",
    age: "8 min ago",
  },
  {
    id: "a3",
    severity: "warning",
    title: "High Memory Pressure",
    description: "Node ip-10-0-2-45 memory usage at 91%, evictions may occur",
    cluster: "prod-eu-west-1",
    namespace: "",
    age: "15 min ago",
  },
  {
    id: "a4",
    severity: "warning",
    title: "Certificate Expiring",
    description: "TLS certificate for *.staging.example.com expires in 7 days",
    cluster: "staging-us-east",
    namespace: "istio-system",
    age: "1h ago",
  },
];

export const clusters = writable<ClusterSummary[]>(DEMO_CLUSTERS);
export const alerts = writable<Alert[]>(DEMO_ALERTS);

export function getCluster(id: string): ClusterSummary | undefined {
  let result: ClusterSummary | undefined;
  clusters.subscribe((list) => {
    result = list.find((c) => c.id === id);
  })();
  return result;
}
