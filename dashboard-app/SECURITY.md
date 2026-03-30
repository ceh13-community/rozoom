# Security

ROZOOM is a desktop application that manages Kubernetes clusters. Security is a core design principle.

## Architecture

ROZOOM is built with [Tauri v2](https://v2.tauri.app/), which provides process isolation between the frontend (WebView) and backend (Rust). The frontend cannot execute arbitrary system commands - all CLI interactions go through a sandboxed capability system.

## What ROZOOM accesses

### Filesystem (read-only unless stated)

| Path                | Purpose                                          | Write                      |
| ------------------- | ------------------------------------------------ | -------------------------- |
| `~/.kube/`          | Kubeconfig files for cluster authentication      | Yes (copies for isolation) |
| `~/.aws/`           | AWS credentials for EKS clusters                 | No                         |
| `~/.config/gcloud/` | GCP credentials for GKE clusters                 | No                         |
| `~/.azure/`         | Azure credentials for AKS clusters               | No                         |
| `~/.config/doctl/`  | DigitalOcean credentials for DOKS clusters       | No                         |
| `~/.config/hcloud/` | Hetzner credentials for HKE clusters             | No                         |
| App data directory  | Cluster configs, health check cache, preferences | Yes                        |

### Network

| Destination               | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| Kubernetes API servers    | All cluster operations (via kubectl/helm sidecars) |
| `127.0.0.1` / `localhost` | Internal API routes only                           |

ROZOOM does **not** make any external HTTP requests to third-party services. All cloud provider API calls go through the bundled CLI tools (aws, gcloud, az, doctl, hcloud, oc).

### CLI tools (bundled sidecars)

All binaries are bundled with the app - ROZOOM never uses system PATH. Each binary is allowlisted in the Tauri capability system:

| Binary                        | Purpose                         |
| ----------------------------- | ------------------------------- |
| kubectl                       | Kubernetes API operations       |
| helm                          | Helm chart management           |
| stern                         | Multi-pod log tailing           |
| pluto                         | Kubernetes deprecation scanning |
| kubeconform                   | YAML validation                 |
| kustomize                     | Kustomize rendering             |
| yq                            | YAML processing                 |
| velero                        | Backup management               |
| doctl, gcloud, hcloud, oc, az | Cloud provider CLIs             |
| aws (bundled dist)            | AWS CLI                         |

## Tauri security configuration

### Content Security Policy (CSP)

The app enforces a CSP that restricts:

- Scripts: only from app bundle (`'self'`)
- Styles: from app bundle + inline (required by Svelte component styles)
- Images: from app bundle + data URIs + blobs
- Connections: only to localhost (internal API)
- No eval, no remote script loading

### Capability system

Tauri v2 capabilities (defined in `src-tauri/capabilities/default.json`) enforce least-privilege:

- **Shell**: only allowlisted sidecar binaries can be executed
- **Filesystem**: scoped to specific directories (kubeconfig, cloud credentials, app data)
- **HTTP**: only localhost connections allowed
- **No arbitrary command execution**: cannot run system commands outside the allowlist

### DevTools

DevTools (F12 inspector) are disabled in production builds (`"devtools": false` in `tauri.conf.json`). In development mode, DevTools are available only when running via `cargo tauri dev` or `pnpm tauri:dev:rozoom` - Tauri enables them automatically for debug builds. Running with `pnpm dev` (Vite-only, no Tauri shell) does not provide F12 DevTools.

## Kubeconfig isolation

ROZOOM copies kubeconfig files to its own app data directory. This prevents:

- Accidental modification of the user's kubeconfig
- Conflicts with other tools modifying kubeconfig simultaneously
- Exposure of kubeconfig paths in process arguments

## Data storage

- Health check results are cached locally in the app data directory
- No data is sent to external servers
- Sentry error tracking (optional) sends crash reports only - no cluster data, credentials, or kubeconfig content

## Reporting security issues

If you discover a security vulnerability, please report it responsibly:

- Email: udawpk@gmail.com
- Do not open a public GitHub issue for security vulnerabilities
