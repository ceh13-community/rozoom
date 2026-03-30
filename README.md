# ROZOOM - K8s Linter IDE

> The Swiss Army Knife for Kubernetes. One app, every cluster, zero dependencies.

ROZOOM is an open-source desktop application for managing Kubernetes clusters. It bundles everything you need - kubectl, helm, stern, velero, and 10 more CLI tools - so you never depend on system PATH or manual installs.

<!-- TODO: hero screenshot here -->

## Why ROZOOM?

- **Zero setup** - all binaries bundled, works on first launch
- **Fleet-first** - manage 1 to 100 clusters from a single dashboard
- **Multi-pane workspace** - compare pods, deployments, logs side-by-side (2 or 3 panes)
- **Smart diagnostics** - health score, cluster score, global triage across all resources
- **One-click tooling** - Helm catalog, GitOps bootstrap, certificate rotation
- **18 cluster types** - EKS, GKE, AKS, Rancher, K3s, minikube, Kind, and more
- **Fast** - native desktop app (Tauri + Svelte), not a browser tab

## Features

### Fleet Dashboard
Health scores, cluster scores, auto-refresh rotation, and data profiles (realtime / balanced / fleet / manual) for any fleet size.

### 61 Resource Pages
Pods, Deployments, DaemonSets, StatefulSets, Jobs, CronJobs, Services, Ingresses, PVCs, ConfigMaps, Secrets, RBAC, CRDs, Network Policies, and 47 more - each with details sheets, YAML editor, and action menus.

### Multi-Pane Workspace
Work in 1, 2, or 3 panes. Each pane can show a different workload type and a different cluster. Pin workspaces to tabs for quick switching.

### Global Triage
Cross-resource problem scanner. Finds config risks, runtime failures, and security issues in one place, ranked by impact.

### One-Click Helm Catalog
Install Prometheus, ArgoCD, Trivy, cert-manager, and 13 more charts with one click. Auto-detects target namespace.

### Shell, Logs, Debug
Interactive shell (exec/attach/debug containers), streaming logs via stern, port forwarding with browser tab integration.

### Smart Recovery
Auto-recovers after VPN reconnect. Fleet heartbeat monitors all clusters in background. Adaptive polling adjusts to network conditions.

### Security & Compliance
KubeArmor integration, Trivy vulnerability scanning, Kubescape compliance checks, RBAC risk scoring, certificate expiry tracking.

## Quick Start

### Download

| Platform | Architecture | Download |
|----------|-------------|----------|
| Linux | x64 | [.deb]() [.rpm]() [.AppImage]() |
| Linux | ARM64 | [.deb]() |
| macOS | Apple Silicon | [.dmg]() |
| macOS | Intel | [.dmg]() |
| Windows | x64 | [.msi]() [.exe]() |

### Build from Source

```bash
git clone https://github.com/ceh13-community/rozoom.git
cd rozoom/dashboard-app
pnpm install
pnpm download:binaries
pnpm tauri dev
```

Prerequisites: Node.js 20+, pnpm, Rust stable, [Tauri v2 system deps](https://v2.tauri.app/start/prerequisites/)

## Supported Clusters

| Type | Examples |
|------|---------|
| Managed cloud | AWS EKS, GKE, AKS, DigitalOcean, Hetzner, Oracle OKE |
| Management platforms | Rancher |
| Self-managed | kubeadm, K3s, RKE2, OpenShift |
| Local | minikube, Kind, K3d, Docker Desktop, Rancher Desktop, Colima |

## Data Profiles

| Profile | Refresh | Best for |
|---------|---------|----------|
| Realtime | 10s | Fast LAN, small clusters |
| Balanced | 30s | Daily use (default) |
| Low Load | 60s | Slow/unstable connections |
| Fleet | 90s | 50-100 clusters |
| Manual | On demand | Minimal API load |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture overview, code standards, and how to add new workload pages.

## License

Apache-2.0. See [LICENSE](LICENSE).

## Support

- [GitHub Issues](https://github.com/ceh13-community/rozoom/issues) - bug reports and feature requests
- [GitHub Discussions](https://github.com/ceh13-community/rozoom/discussions) - questions and ideas
- [GitHub Sponsors](https://github.com/sponsors/ceh13-community) - support development

---

Built with [Svelte 5](https://svelte.dev), [Tauri 2](https://tauri.app), and [TypeScript](https://www.typescriptlang.org).
