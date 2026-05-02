export interface Framework {
  id: string;
  label: string;
  description: string;
  controls: string;
}

export const KUBESCAPE_FRAMEWORKS: Framework[] = [
  {
    id: "nsa",
    label: "NSA",
    description:
      "NSA/CISA Kubernetes Hardening Guidance - pod security, access control, supply chain.",
    controls: "~27",
  },
  {
    id: "mitre",
    label: "MITRE ATT&CK",
    description: "Kubernetes-specific attack patterns from the MITRE ATT&CK matrix.",
    controls: "~37",
  },
  {
    id: "cis-v1.23",
    label: "CIS v1.23",
    description: "CIS Kubernetes Benchmark v1.23 - workload portion (pods, RBAC, misconfig).",
    controls: "~90",
  },
  {
    id: "soc2",
    label: "SOC2",
    description: "Controls mapped to SOC2 Trust Service Criteria (security + availability).",
    controls: "~40",
  },
  {
    id: "armobest",
    label: "ArmoBest",
    description: "ARMO Security's curated best-practice framework, most opinionated.",
    controls: "~60",
  },
  {
    id: "allcontrols",
    label: "AllControls",
    description: "Every control Kubescape knows - broadest, noisiest, most thorough.",
    controls: "~200",
  },
];

export const KUBE_BENCH_FRAMEWORKS: Framework[] = [
  {
    id: "cis-node",
    label: "CIS Node",
    description: "CIS Kubernetes Benchmark - kubelet, node config, container runtime.",
    controls: "~20",
  },
  {
    id: "cis-control-plane",
    label: "CIS Control plane",
    description: "CIS Benchmark - API server, controller-manager, scheduler, etcd flags.",
    controls: "~65",
  },
  {
    id: "cis-policies",
    label: "CIS Policies",
    description: "CIS Benchmark - RBAC, PodSecurityPolicy/Admission, network policy coverage.",
    controls: "~20",
  },
];
