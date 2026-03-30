# Philosophy

ROZOOM is a Swiss Army Knife for Kubernetes - an all-in-one fleet IDE that gives platform engineers and DevOps teams complete visibility and control over their clusters.

## Core principles

### 1. Zero dependencies

ROZOOM bundles every CLI tool it needs. It never reaches into system PATH. A fresh install on a clean machine works immediately - no `brew install kubectl`, no `apt-get install helm`, no version conflicts.

This means:

- Every user gets the same tool versions
- No "works on my machine" problems
- Air-gapped environments work out of the box
- Tool updates are coordinated with app releases

### 2. Fleet-first

Most K8s tools show one cluster at a time. ROZOOM shows all clusters simultaneously on a single dashboard. Health scores, alerts, and metrics are compared across the fleet at a glance.

The dashboard is designed to scale from 4 to 100+ clusters with virtualized rendering, adaptive polling, and connection budgeting.

### 3. Read-heavy, write-careful

ROZOOM is primarily an observability tool. Reads (get, describe, logs, top) happen automatically in the background. Writes (apply, delete, scale, rollout) require explicit user action and show a CLI notification with the exact command being executed.

Users should always know what ROZOOM is doing to their clusters.

### 4. Graceful degradation

Not every cluster has metrics-server. Not every environment has Prometheus. ROZOOM adapts:

- Metrics unavailable? Hide the metrics section, don't show an error
- API server slow? Increase polling intervals automatically
- Connection lost? Show "Offline" clearly, resume when back
- Partial data? Show what we have, indicate what's missing

### 5. No cloud lock-in

ROZOOM works with any Kubernetes cluster: minikube, kind, EKS, GKE, AKS, DOKS, Hetzner, OpenShift, bare metal. Cloud-specific features (like managed node pools) are detected automatically but never required.

### 6. Local-first

All data stays on the user's machine:

- Health check cache is local
- Preferences are local
- No telemetry, no analytics, no phone-home
- Sentry crash reporting is optional and contains no cluster data

### 7. Transparency

Every kubectl/helm command executed by ROZOOM is visible to the user via CLI notifications. The notification shows the full command, completion time, and has a Copy button so users can reproduce any action in their terminal.

## Goals

### What we're building

ROZOOM aims to be the single desktop app that replaces the daily workflow of switching between `kubectl`, `helm`, Lens, k9s, Grafana, and cloud provider consoles. One app, all clusters, zero context switching.

### Short-term goals (v0.14 - v1.0)

- **Production-grade workbench** - YAML editing with CodeMirror, virtualized logs, live metrics badges, CLI command transparency
- **Fleet health scoring** - 0-100 health score per cluster with top risks, change detection, and historical trends
- **Helm lifecycle** - one-click install/upgrade/uninstall from a curated catalog of observability, security, and compliance charts
- **Security posture** - Pod Security Standards, network isolation, secrets hygiene, RBAC overview, certificate monitoring
- **Multi-provider support** - EKS, GKE, AKS, DOKS, Hetzner, OpenShift, bare metal - all from one dashboard

### Medium-term goals (v1.0 - v2.0)

- **GitOps integration** - visualize ArgoCD/Flux sync status, diff against git, detect drift
- **Cost analysis** - per-namespace and per-workload resource cost estimation
- **Incident timeline** - correlate pod restarts, OOM kills, node pressure, and deployments on a unified timeline
- **Team collaboration** - shareable cluster profiles, saved views, exportable reports
- **Plugin system** - allow third-party extensions for custom health checks, actions, and views

### Long-term vision

- **AI-assisted troubleshooting** - natural language queries about cluster state, automated root cause analysis
- **Compliance automation** - continuous CIS benchmark scanning, SOC2/HIPAA mapping, audit trail
- **Multi-cluster operations** - federated deployments, cross-cluster service discovery, fleet-wide rollouts

## Architecture decisions

### Feature-Sliced Design (FSD)

The codebase follows FSD for clear ownership boundaries:

```
src/lib/
  shared/    - UI components, utilities, API layer
  entities/  - Business domain (Pod, Deployment, Node, etc.)
  features/  - Feature modules (health checks, metrics, shell, etc.)
  widgets/   - Composite UI (sidebar, datalists, workbench)
  pages/     - Page-level components
```

Each feature module is self-contained with its own API, model (state), and UI layers. New features can be developed without understanding the entire codebase.

### Tauri v2

We chose Tauri over Electron for:

- Smaller bundle size (~50MB vs ~200MB+)
- Native performance (Rust backend)
- Better security model (capability-based permissions)
- Lower memory footprint

### Svelte 5

Svelte 5 runes ($state, $derived, $effect) provide fine-grained reactivity without a virtual DOM. This matters for dashboards that update hundreds of data points every few seconds.

### CodeMirror

The YAML editor uses CodeMirror 6 instead of Monaco because:

- Smaller bundle (~200KB vs ~5MB)
- Better mobile/embedded support
- Extensible architecture for K8s-specific autocomplete

## What ROZOOM is not

- **Not a CI/CD tool** - ROZOOM doesn't deploy your apps. Use ArgoCD, Flux, or your CI pipeline for that.
- **Not a monitoring replacement** - ROZOOM shows real-time health, but Prometheus + Grafana is still your long-term metrics stack.
- **Not a service mesh** - ROZOOM observes your mesh (Istio, Linkerd) but doesn't replace it.
- **Not cloud-specific** - Works everywhere Kubernetes runs.
