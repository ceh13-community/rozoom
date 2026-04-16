# ROZOOM - K8s Linter IDE

**A Swiss Army Knife for Kubernetes - an all-in-one fleet IDE that gives platform engineers and DevOps teams complete visibility and control over their clusters. Built with Tauri and SvelteKit.**

ROZOOM delivers a lightweight, secure, and fast cross-platform desktop experience for Kubernetes engineers, combining a modern web UI with a native Rust backend.

---

## Table of Contents

- [Recommended IDE Setup](#recommended-ide-setup)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [Local Development](#local-development)
  - [Docker: Build & Package](#docker-build--package)
- [Code Signing](#code-signing)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Feature Overview](#feature-overview)
- [Configuration & Storage](#configuration--storage)
- [Developer Workflow](#developer-workflow)
- [Docker Compose (Optional)](#docker-compose-optional)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Recommended IDE Setup

| Tool             | Link                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code          | [https://code.visualstudio.com/](https://code.visualstudio.com/)                                                                                           |
| Svelte Extension | [https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode)       |
| Tauri Extension  | [https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) |
| Rust Analyzer    | [https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) |

---

## Prerequisites

Before you begin, ensure the following tools are installed:

- **Node.js** ≥ 20.x
- **pnpm** (recommended package manager)
- **Rust toolchain** (stable)
- **Tauri system dependencies**
  See the official documentation: [https://tauri.app/v2/](https://tauri.app/v2/)

---

## Quick Start

### Local Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/ceh13-community/rozoom.git
cd dashboard-app
pnpm install
```

Run formatting, static checks, and unit tests:

```bash
pnpm format
pnpm run check
pnpm vitest
```

Download required external binaries (kubectl, helm, cloud CLIs):

```bash
pnpm download:binaries
```

Start the development app:

```bash
pnpm tauri dev
```

The application window will open automatically and reload on code changes.

#### Downloaded binaries structure

```text
src-tauri/binaries/
├── kubectl
├── helm
├── doctl
├── aws
└── google-cloud-sdk/
    └── bin/
        ├── gcloud        (linux/macOS)
        └── gcloud.cmd    (windows)
```

---

## Docker: Build & Package

The project provides a **fully reproducible, multi-stage Docker build** for producing official desktop artifacts in a clean environment.

### Build desktop artifacts (Linux)

```bash
cd dashboard-app
export DOCKER_BUILDKIT=1
docker build \
  --build-arg TERMINAL_DEBUG=true \
  -t k8s-dashboard-app \
  -f Dockerfile_linux_new.ver .
```

Extract build artifacts:

```bash
docker run -d --name k8s-dashboard-build k8s-dashboard-app sleep infinity
docker cp k8s-dashboard-build:/app ./local-copy
docker rm -f k8s-dashboard-build
```

The `local-copy/` directory will contain:

- `deb/ROZOOM_K8s_Linter_IDE_<version>_amd64.deb`
- `rpm/ROZOOM_K8s_Linter_IDE_<version>_x86_64.rpm`

### Run unsigned application on macOS

After installing the DMG, macOS may quarantine the app. Remove the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/ROZOOM\ -\ K8s\ Linter\ IDE.app
```

### What the Docker build includes

- SvelteKit frontend compilation
- Deterministic pnpm dependency installation
- Rust/Cargo dependency caching
- Tauri desktop bundling
- Minimal final image containing **only build artifacts**

### Run unit tests only (CI-friendly)

To execute frontend unit tests without building the full desktop app:

```bash
docker build \
  --target=test \
  -t dashboard-tests \
  -f Dockerfile_linux_new.ver .
```

This stage runs **Vitest with coverage** and is ideal for CI pipelines.

### BuildKit & caching (recommended)

Ensure Docker BuildKit is enabled:

```bash
export DOCKER_BUILDKIT=1
```

Caching strategies used:

- **pnpm store cache**
- **Cargo registry & git cache**
- Multi-stage builds to minimize rebuild time

---

## Code Signing

Without code signing, users see security warnings on both platforms:

- **Windows**: SmartScreen "Windows protected your PC" warning
- **macOS**: Gatekeeper blocks the app ("app is damaged and can't be opened")

### Windows - EV Code Signing

An **EV (Extended Validation) Code Signing Certificate** removes SmartScreen warnings immediately.
A standard OV certificate works too but requires building up download reputation first.

| Provider | Type | Price/year   | Notes                      |
| -------- | ---- | ------------ | -------------------------- |
| SignPath | EV   | Free for OSS | GitHub Actions integration |
| SSL.com  | EV   | ~$350        | Cloud signing (eSigner)    |
| Sectigo  | EV   | ~$400        | Hardware token required    |
| DigiCert | EV   | ~$600        | Fastest reputation         |

Add to `tauri.conf.json`:

```json
{
  "bundle": {
    "windows": {
      "certificateThumbprint": "YOUR_CERT_THUMBPRINT",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com"
    }
  }
}
```

### macOS - Developer ID + Notarization

Requires an **Apple Developer Program** membership ($99/year).

1. Create a **Developer ID Application** certificate in Apple Developer portal
2. Export as `.p12` and store as a GitHub Actions secret
3. Tauri v2 handles notarization automatically when these env vars are set:
   - `APPLE_SIGNING_IDENTITY` - e.g. `Developer ID Application: ROZOOM (TEAM_ID)`
   - `APPLE_ID` - Apple ID email
   - `APPLE_PASSWORD` - App-specific password (generate at appleid.apple.com)
   - `APPLE_TEAM_ID` - 10-character team identifier

Add to `tauri.conf.json`:

```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: ROZOOM (TEAM_ID)"
    }
  }
}
```

### CI Workflow

A draft GitHub Actions workflow is available at `.github/workflows/code-signing.draft.yml`.
To activate it:

1. Purchase certificates (see tables above)
2. Add the required secrets to GitHub repository settings
3. Update `tauri.conf.json` with certificate thumbprint (Windows) and signing identity (macOS)
4. Rename the file to `code-signing.yml`

---

## Tech Stack

- **Frontend:** SvelteKit, TypeScript, pnpm
- **Desktop Backend:** Rust, Tauri v2
- **Testing:** Vitest
- **Packaging:** Tauri Bundler (AppImage, DEB, RPM)
- **Build & DevOps:** Docker, BuildKit, multi-stage builds

---

## Architecture Overview

```
+------------------------------------------------------------------+
|                     ROZOOM Desktop App                            |
|                                                                  |
|  +---------------------------+  +-----------------------------+  |
|  |     SvelteKit Frontend    |  |    Tauri 2 + Rust Backend   |  |
|  |                           |  |                             |  |
|  |  Pages (FSD layers):      |  |  - Native window shell     |  |
|  |    /dashboard     Fleet   |  |  - IPC bridge (commands)    |  |
|  |    /cluster-mgr   Setup   |  |  - File system access       |  |
|  |    /cluster/[id]  Ops     |  |  - Shell plugin (CLI exec)  |  |
|  |                           |  |  - Store plugin (JSON)      |  |
|  |  Features (20 modules):   |  |  - Cache plugin             |  |
|  |    check-health (37)      |  |  - HTTP plugin              |  |
|  |    workloads-mgmt (54)    |  |  - Dialog plugin            |  |
|  |    cluster-manager        |  |  - Log plugin               |  |
|  |    alerts-hub             |  +-----------------------------+  |
|  |    compliance-hub         |                                   |
|  |    trivy-hub              |  +-----------------------------+  |
|  |    backup-audit           |  |   13 Bundled CLI Binaries   |  |
|  |    ...                    |  |                             |  |
|  |                           |  |  kubectl, helm, kustomize,  |  |
|  |  Widgets (237 components) |  |  kubeconform, pluto, stern, |  |
|  |  Shared (111 utilities)   |  |  velero, yq, aws, doctl,   |  |
|  |  Plugins (12 plugins)     |  |  hcloud, oc, az            |  |
|  +---------------------------+  +-----------------------------+  |
|                                                                  |
|  +------------------------------------------------------------+  |
|  |                    Plugin System                            |  |
|  |  Core (4) | Free (3) | Pro (5) | Community (extensible)    |  |
|  |  Feature flags + 14-day trial + license management         |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
         |                    |                    |
    Linux (DEB/RPM)     macOS (DMG)        Windows (MSI/NSIS)
```

### Feature-Sliced Design (FSD)

```
src/lib/
  entities/       Data models (cluster, config, pod, workload)
  features/       Business logic (20 isolated feature modules)
  widgets/        UI components (237 Svelte components)
  pages/          Page-level components (dashboard, cluster, settings)
  shared/         Utilities, API clients, plugins, stores, UI primitives
```

### Data Flow

```
User -> Cluster Page -> Workload Store -> kubectl (bundled) -> K8s API
                     -> Health Checks -> Cache Store -> Dashboard Cards
                     -> Plugin System -> Feature Flags -> Enable/Disable
```

### Key Design Decisions

- **Zero OS dependencies**: all 20 CLI tools bundled as Tauri sidecars/resources
- **Offline-first**: health check data cached locally, works without network
- **Plugin architecture**: features isolated as toggleable plugins with tiers
- **Concurrent budget**: kubectl operations limited by configurable concurrency pool
- **Lazy loading**: all workload pages loaded on-demand via dynamic imports

---

## Feature Overview

- Cross-platform desktop application (Linux, macOS, Windows)
- Kubernetes cluster visualization and management
- Embedded CLI tooling (kubectl, helm, cloud providers)
- Fast, lightweight UI
- Secure native backend via Rust + Tauri
- Docker-first build and CI workflows

### Health & Reliability Signals

The dashboard exposes two complementary scoring models:

- **Runtime Health Score** - what is degrading right now (control plane, nodes, workloads, observability, platform hygiene).
- **Config Reliability & Security Score** - what is likely to fail based on configuration risk.

Together they provide a fast, decision-oriented summary for SREs and platform teams.

### Per-Cluster Linter Toggle

Each cluster card (compact and detailed) has a **Linter** toggle in the header. When disabled:

- Diagnostics (configuration check, infrastructure, health checks) are not scheduled.
- Scores (Health Score, Cluster Score) and goal blocks are hidden.
- Basic workload refresh (pod/deployment/node counts, status) continues normally.

The toggle state is persisted per cluster and synchronized across compact/detailed views.

### Cluster Overview Page

Navigating into a cluster opens the **Overview** page with a full diagnostic pass that includes checks the fleet cards skip for performance (certificates, ETCD, APF, kubelet proxy, admission webhooks, full metrics probes). See [`docs/overview.md`](docs/overview.md) for the full diagnostic scope matrix, control plane check details, and distribution-specific behavior.

---

## Configuration & Storage

The app stores user settings and cluster metadata locally using the Tauri store plugin.

### Cluster configuration

Cluster definitions are stored in a local JSON store and are loaded on startup.

### Dashboard preferences

Per-user preferences are saved to a local preferences store (`dashboard-preferences.json`). Persisted settings include:

- **Refresh interval** - the auto-refresh cadence selected for each cluster card.
- **Linter toggle** - per-cluster ON/OFF switch that controls whether diagnostics (config checks, health checks, infrastructure analysis, scores) run for a given cluster. When OFF, the card still performs basic workload refresh but skips all diagnostic workloads, hiding the corresponding UI sections. Useful for slow or remote clusters where diagnostics cause API server timeouts.

---

## Developer Workflow

### Required checks

Before sending a PR, make sure these pass:

```bash
pnpm format
pnpm run check
pnpm vitest
```

### Common tasks

- **Add a new health signal:** implement a check in `src/lib/features/check-health/api`, extend the model types, and wire it into the runtime health score.
- **Add a new config risk:** add a checker under `src/lib/features/check-health/api` and register the risk in the config score model.
- **Add a new UI card:** create a Svelte component under `src/lib/widgets/cluster/ui` and include it in the cluster info card.

### Workload workbench checklist

When adding/updating workload pages (Pods, Deployments, StatefulSets, etc.), use this checklist to keep behavior consistent and avoid UI regressions:

1. Reuse shared workbench building blocks from `src/lib/features/pods-workbench`:
   - `WorkbenchHeader` for tabs/controls layout.
   - `orderPinnedTabs` for pinned/unpinned ordering.
   - `computeLayoutClosePlan` for pane shrink/close logic.
2. Keep tab labels in the same pattern:
   - `title`: `{Kind} {resourceName}`
   - `subtitle`: `{namespace}`
3. For logs stream mode, use `openStreamWithOptionalFallback` and preserve reconnect behavior.
4. Add/extend tests for:
   - log args builders,
   - tab/pane layout helpers,
   - bulk/menu actions for new buttons.
5. Run full gate before PR:
   - `pnpm vitest`
   - `pnpm lint`
   - `pnpm format:check`
   - `pnpm exec svelte-check --tsconfig ./tsconfig.json`

### Code organization highlights

- `src/lib/features/check-health/` - health collection, caching, and scoring models.
- `src/lib/widgets/cluster/ui/` - cluster dashboard cards and health panels.
- `src-tauri/` - Tauri application configuration and Rust sources.

---

## Docker Compose (Optional)

For CI or team workflows:

```yaml
version: "3.8"
services:
  k8s-dashboard-app:
    build:
      context: .
      dockerfile: Dockerfile_linux_new.ver
      args:
        TERMINAL_DEBUG: "true"
    image: k8s-dashboard-app:latest
    command: sleep infinity
```

```bash
docker compose up --build -d
docker compose down --remove-orphans
```

---

## Contributing

We welcome contributions from the community 🚀

### Workflow

1. Fork the repository
2. Create a feature branch:

   ```bash
   git checkout -b feature/my-feature
   ```

3. Implement changes (with tests if applicable)
4. Commit using clear, conventional messages:

   ```bash
   git commit -m "feat: add cluster health overview"
   ```

5. Push and open a Pull Request

### Guidelines

- Follow existing linting and formatting rules
- Ensure `pnpm vitest` and Docker builds pass
- Keep changes focused and well-documented

### Issues & Requests

- Use GitHub Issues for bugs and feature requests
- Prefix titles with: `bug:`, `feature:`, `docs:`, `chore:`

---

## License

This project is licensed under the **Apache License 2.0**.
See the [LICENSE](../LICENSE) and [NOTICE](../NOTICE) files for details.

### Bundled CLI tools

All bundled tools are Apache 2.0 or MIT licensed. See [NOTICE](../NOTICE) for the full list.

**Note:** Google Cloud SDK (`gcloud`) is **not bundled** due to Google Cloud SDK Terms of Service
restrictions on redistribution. Only the standalone `gke-gcloud-auth-plugin` (Apache 2.0)
is referenced. Users who need full `gcloud` CLI should install it separately:
https://cloud.google.com/sdk/install

---

## Support the Project

ROZOOM is free and open-source. If it saves you time, consider supporting its development:

| Platform            | Link                                                             |
| ------------------- | ---------------------------------------------------------------- |
| **GitHub Sponsors** | [Sponsor on GitHub](https://github.com/sponsors/ceh13-community) |
| **Buy Me a Coffee** | [buymeacoffee.com/rozoom](https://buymeacoffee.com/rozoom)       |
| **Open Collective** | [opencollective.com/rozoom](https://opencollective.com/rozoom)   |

Every contribution helps maintain bundled tools, add new features, and keep the project independent.

**Other ways to help:**

- Star the repository
- Report bugs and suggest features via [GitHub Issues](https://github.com/ceh13-community/rozoom/issues)
- Contribute code, documentation, or translations
- Share ROZOOM with your DevOps team

---

## Acknowledgments

- The **Tauri** and **Svelte** communities for exceptional tooling
- The **Kubernetes**, **CNCF**, and **Cloud Native** ecosystem for open standards
- All contributors helping build an open, developer-first Kubernetes tool
