# Platform Compatibility

ROZOOM auto-detects cluster distribution and cloud provider to adapt
its behavior. Detection uses server URL patterns, kubeconfig exec commands,
cluster/context name patterns, node names, server version strings, and
provider IDs from node specs.

---

## Supported Cluster Types

### Managed Cloud

| Provider          | Detection                                         | Bundled CLI                            | Cert Management    |
| ----------------- | ------------------------------------------------- | -------------------------------------- | ------------------ |
| AWS EKS           | `*.eks.amazonaws.com`, `aws` exec, name patterns  | `aws` (resource bundle)                | Managed by AWS     |
| GKE               | `*.googleapis.com`, `gke-gcloud-auth-plugin` exec | `gcloud` (not bundled - user installs) | Managed by Google  |
| AKS               | `*.azmk8s.io`, `kubelogin` exec                   | `az` (sidecar)                         | Managed by Azure   |
| DigitalOcean DOKS | `*.k8s.ondigitalocean.com`, `doctl` exec          | `doctl` (sidecar)                      | Managed by DO      |
| Hetzner           | `*.hcloud.app`, name patterns                     | `hcloud` (sidecar)                     | Managed by Hetzner |
| Oracle OKE        | `*.oraclecloud.com`, name patterns                | -                                      | Managed by Oracle  |

### Management Platforms

| Platform | Detection                        | Notes                                 |
| -------- | -------------------------------- | ------------------------------------- |
| Rancher  | `*/k8s/clusters/*` in server URL | Downstream clusters via Rancher proxy |

### Self-Managed

| Distribution | Detection                        | Cert Rotation                      | Notes                        |
| ------------ | -------------------------------- | ---------------------------------- | ---------------------------- |
| kubeadm      | Default fallback                 | `kubeadm certs renew all` via exec | Full auto-rotate support     |
| K3s          | Server version contains `k3s`    | Restart k3s service                | Certs auto-rotate on restart |
| RKE2         | Server version contains `rke2`   | Restart rke2 service               | Certs auto-rotate on restart |
| OpenShift    | `openshift.io` API group present | CSR approval via kubectl           | `oc` CLI bundled             |
| Bare metal   | Name patterns, manual            | kubeadm or CSR approval            | Depends on installer used    |

### Local Development Runtimes

| Runtime         | Detection                  | Cert Rotation            | Notes                              |
| --------------- | -------------------------- | ------------------------ | ---------------------------------- |
| Minikube        | Node name `minikube`       | `minikube stop && start` | Regenerates certs on restart       |
| Kind            | Node names `kind-*`        | Recreate cluster         | Ephemeral - recreate is typical    |
| K3d             | Node names `k3d-*`         | Stop and start cluster   | K3s-based, certs rotate on restart |
| Docker Desktop  | Node name `docker-desktop` | Reset K8s in settings    | Built-in K8s cluster               |
| Rancher Desktop | Node name patterns         | Reset in preferences     | K3s or RKE2 under the hood         |
| Colima          | Node name patterns         | `colima stop && start`   | Lima VM with K3s or K8s            |

---

## Desktop Platform Support

| Platform    | Architecture              | Artifacts                   | Status          |
| ----------- | ------------------------- | --------------------------- | --------------- |
| **Linux**   | x86_64                    | `.deb`, `.rpm`, `.AppImage` | Production      |
| **Linux**   | ARM64 (aarch64)           | `.deb`                      | CI ready        |
| **macOS**   | ARM64 (Apple Silicon M1+) | `.dmg`                      | Production      |
| **macOS**   | x64 (Intel)               | `.dmg`                      | Production      |
| **Windows** | x64                       | `.msi`, `.exe` (NSIS)       | Production      |
| **Windows** | ARM64                     | Not yet                     | Planned         |
| **Android** | ARM64                     | `.apk`                      | Planned (alpha) |
| **iOS**     | ARM64                     | `.ipa`                      | Planned         |

### Android Roadmap

Tauri 2 supports Android via `pnpm tauri android init`. Remaining work for alpha:

1. **API layer**: Replace kubectl subprocess calls with K8s REST API over HTTP (kubectl binaries don't run on Android)
2. **Auth**: Implement kubeconfig parsing + token-based auth via HTTP client
3. **UI**: Adapt layouts for touch/mobile (responsive already via Tailwind)
4. **Storage**: Use Tauri mobile storage plugins instead of desktop file system
5. **Build**: Android SDK 34 + NDK 26 + Rust aarch64-linux-android target

---

## Bundled CLI Tools

All CLI tools are bundled inside the application. No system PATH dependencies.

| Tool        | Purpose                  | Provider     | Sidecar Name       |
| ----------- | ------------------------ | ------------ | ------------------ |
| kubectl     | Core K8s operations      | All          | rozoom-kubectl     |
| helm        | Chart management         | All          | rozoom-helm        |
| kustomize   | Manifest customization   | All          | rozoom-kustomize   |
| kubeconform | YAML validation          | All          | rozoom-kubeconform |
| pluto       | API deprecation scanning | All          | rozoom-pluto       |
| stern       | Multi-pod log tailing    | All          | rozoom-stern       |
| velero      | Backup and restore       | All          | rozoom-velero      |
| yq          | YAML processing          | All          | rozoom-yq          |
| aws         | AWS CLI v2               | AWS EKS      | Resource bundle    |
| gcloud      | Google Cloud SDK         | GKE          | rozoom-gcloud-cli  |
| doctl       | DigitalOcean CLI         | DigitalOcean | rozoom-doctl       |
| hcloud      | Hetzner Cloud CLI        | Hetzner      | rozoom-hcloud      |
| oc          | OpenShift CLI            | OpenShift    | rozoom-oc          |
| az          | Azure CLI                | AKS          | rozoom-az-cli      |

---

## Cloud Credential Detection

ROZOOM probes standard credential paths to show connection status:

| Provider     | Paths checked                                                                          |
| ------------ | -------------------------------------------------------------------------------------- |
| AWS          | `~/.aws/credentials`, `~/.aws/config`                                                  |
| GCP          | `~/.config/gcloud/properties`, `~/.config/gcloud/application_default_credentials.json` |
| Azure        | `~/.azure/config`, `~/.azure/azureProfile.json`                                        |
| DigitalOcean | `~/.config/doctl/config.yaml`                                                          |
| Hetzner      | `~/.config/hcloud/cli.toml`, `~/.config/hcloud/context.json`                           |

---

## Feature Compatibility Matrix

| Feature              | Managed   | Self-managed | Local         |
| -------------------- | --------- | ------------ | ------------- |
| Fleet dashboard      | Yes       | Yes          | Yes           |
| Health score         | Yes       | Yes          | Yes           |
| Config score         | Yes       | Yes          | Yes           |
| Workload management  | Yes       | Yes          | Yes           |
| Helm operations      | Yes       | Yes          | Yes           |
| API deprecation scan | Yes       | Yes          | Yes           |
| Version audit        | Yes       | Yes          | Yes           |
| Backup (Velero)      | Yes       | Yes          | Partial       |
| Certificate rotation | View only | Full         | View + manual |
| Metrics sources      | Yes       | Yes          | Yes           |
| Log streaming        | Yes       | Yes          | Yes           |
| Port forwarding      | Yes       | Yes          | Yes           |
