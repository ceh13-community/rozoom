# Philosophy

ROZOOM is a Swiss Army Knife for Kubernetes - an all-in-one fleet IDE that gives platform engineers and DevOps teams complete visibility and control over their clusters.

## Core principles

### 1. Bundled tools

ROZOOM ships the CLI tools it needs: kubectl and Helm in every build, the rest in the full-offline build. For its own work it runs those copies, not the ones on your system PATH; [`SECURITY.md`](SECURITY.md) lists the exceptions. A fresh install on a clean machine works immediately - no `brew install kubectl`, no `apt-get install helm`, no version conflicts.

This means:

- Every user gets the same tool versions
- No "works on my machine" problems
- The full-offline build carries its tools into air-gapped environments
- Tool updates are coordinated with app releases

### 2. Fleet-first

Most K8s tools show one cluster at a time. ROZOOM shows all clusters simultaneously on a single dashboard. Health scores, alerts, and metrics are compared across the fleet at a glance.

The dashboard is built for a fleet, not for one cluster: each cluster gets its own connection budget, the Data mode (Realtime, Balanced, Low Load, Fleet, Manual) sets the polling and the background load for all of them at once, and long lists render only the rows in view.

### 3. Read-heavy, write-careful

ROZOOM is primarily an observability tool. Reads (get, describe, logs, top) happen automatically in the background. Writes (apply, delete, scale, rollout) require explicit user action; a destructive one asks first and names the kubectl command it will run. With Show kubectl commands switched on in the sidebar, every write also shows a notification with the exact command (see Transparency).

Users should always know what ROZOOM is doing to their clusters.

### 4. Graceful degradation

Not every cluster has metrics-server. Not every environment has Prometheus. ROZOOM adapts:

- Metrics unavailable? Say so in one line and offer to install metrics-server; no error page
- API server slow or the link weak? Switch the Data mode to Low Load or Manual; polling and background checks follow it
- Connection lost? Show "Cluster unreachable" with the reason and Retry, and reload the lists once the cluster answers again
- Partial data? Show what we have and mark it: Cached, Stale, Unknown or Not checked

### 5. No cloud lock-in

ROZOOM works with any Kubernetes cluster: minikube, kind, EKS, GKE, AKS, DOKS, Hetzner, OpenShift, bare metal. The provider is recognised from the cluster itself, and cloud import through a provider CLI is optional: nothing in ROZOOM needs a cloud account.

### 6. Local-first

Cluster data stays on the user's machine:

- Health check cache is local
- Preferences are local
- Usage telemetry is opt-in: nothing is sent until you choose Allow, and cluster contents are never part of it
- The app checks GitHub for updates on every start
- Crash reporting is not configured in release builds

### 7. Transparency

Every write ROZOOM runs can be watched: switch on Show kubectl commands in the sidebar and each kubectl or helm command behind your actions shows a notification with the full command, its completion time and a Copy button, so you can reproduce it in your terminal. The switch is off by default; background reads and the app's own housekeeping commands never notify.

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
