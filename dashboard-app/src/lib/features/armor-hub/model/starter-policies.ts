export interface StarterPolicy {
  id: string;
  title: string;
  description: string;
  severity: number;
  action: "Audit" | "Block";
  yaml: string;
  kind: "KubeArmorPolicy" | "KubeArmorClusterPolicy" | "KubeArmorHostPolicy";
}

export const STARTER_POLICIES: StarterPolicy[] = [
  {
    id: "block-shell-in-pods",
    title: "Block interactive shells in pods",
    description:
      "Denies execution of /bin/bash, /bin/sh, /bin/ash, /usr/bin/zsh inside any pod cluster-wide. Catches attacker reverse shells and kubectl exec misuse.",
    severity: 7,
    action: "Block",
    kind: "KubeArmorClusterPolicy",
    yaml: `apiVersion: security.kubearmor.com/v1
kind: KubeArmorClusterPolicy
metadata:
  name: block-shells
spec:
  severity: 7
  message: "Interactive shell invoked in pod - blocked"
  action: Block
  selector:
    matchExpressions:
      - key: namespace
        operator: NotIn
        values: ["kube-system", "kubearmor"]
  process:
    matchPaths:
      - path: /bin/bash
      - path: /bin/sh
      - path: /bin/ash
      - path: /usr/bin/zsh
`,
  },
  {
    id: "deny-write-etc",
    title: "Deny writes to /etc (passwd, shadow, sudoers)",
    description:
      "Blocks write/modify access to /etc/passwd, /etc/shadow, /etc/sudoers. Stops privilege escalation attempts via user manipulation.",
    severity: 8,
    action: "Block",
    kind: "KubeArmorClusterPolicy",
    yaml: `apiVersion: security.kubearmor.com/v1
kind: KubeArmorClusterPolicy
metadata:
  name: protect-etc
spec:
  severity: 8
  message: "Write to sensitive /etc file attempted"
  action: Block
  selector: {}
  file:
    matchPaths:
      - path: /etc/passwd
        readOnly: true
      - path: /etc/shadow
        readOnly: true
      - path: /etc/sudoers
        readOnly: true
`,
  },
  {
    id: "block-sa-token-access",
    title: "Block access to service account token",
    description:
      "Prevents pods from reading their own ServiceAccount token file. Reduces blast radius of compromised pods.",
    severity: 9,
    action: "Block",
    kind: "KubeArmorClusterPolicy",
    yaml: `apiVersion: security.kubearmor.com/v1
kind: KubeArmorClusterPolicy
metadata:
  name: block-sa-token
spec:
  severity: 9
  message: "Pod attempted to read service account token"
  action: Block
  selector:
    matchExpressions:
      - key: namespace
        operator: NotIn
        values: ["kube-system", "kubearmor"]
  file:
    matchDirectories:
      - dir: /var/run/secrets/kubernetes.io/serviceaccount/
        recursive: true
`,
  },
  {
    id: "audit-package-install",
    title: "Audit package manager activity",
    description:
      "Audit mode: logs every apt/apk/yum/dnf execution. Helps catch image-tampering or live package install in running containers.",
    severity: 5,
    action: "Audit",
    kind: "KubeArmorClusterPolicy",
    yaml: `apiVersion: security.kubearmor.com/v1
kind: KubeArmorClusterPolicy
metadata:
  name: audit-pkg-managers
spec:
  severity: 5
  message: "Package manager invoked in pod"
  action: Audit
  selector: {}
  process:
    matchPaths:
      - path: /usr/bin/apt
      - path: /usr/bin/apt-get
      - path: /sbin/apk
      - path: /usr/bin/yum
      - path: /usr/bin/dnf
      - path: /bin/pip
      - path: /usr/local/bin/pip
`,
  },
  {
    id: "block-network-raw",
    title: "Block raw packet sockets",
    description:
      "Blocks CAP_NET_RAW usage (ICMP floods, ARP spoofing, packet capture from inside pods).",
    severity: 8,
    action: "Block",
    kind: "KubeArmorClusterPolicy",
    yaml: `apiVersion: security.kubearmor.com/v1
kind: KubeArmorClusterPolicy
metadata:
  name: block-raw-net
spec:
  severity: 8
  message: "Raw socket usage blocked"
  action: Block
  selector: {}
  network:
    matchProtocols:
      - protocol: raw
      - protocol: icmp
`,
  },
  {
    id: "block-cap-sys-admin",
    title: "Block CAP_SYS_ADMIN operations",
    description:
      "Blocks privileged capability usage (mount, syscall-level kernel mods). A common escape-to-host vector.",
    severity: 9,
    action: "Block",
    kind: "KubeArmorClusterPolicy",
    yaml: `apiVersion: security.kubearmor.com/v1
kind: KubeArmorClusterPolicy
metadata:
  name: block-sys-admin
spec:
  severity: 9
  message: "Privileged capability usage blocked"
  action: Block
  selector: {}
  capabilities:
    matchCapabilities:
      - capability: sys_admin
      - capability: sys_module
      - capability: sys_ptrace
`,
  },
];
