# Security

ROZOOM is a desktop application that manages Kubernetes clusters. Security is a core design principle.

## Architecture

ROZOOM is built with [Tauri v2](https://v2.tauri.app/), which provides process isolation between the frontend (WebView) and backend (Rust). The frontend reaches the system only through the Tauri capability system described below.

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

| Destination                                          | When                                                                                  | Purpose                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Kubernetes API servers                               | Working with a cluster; opening the cluster manager, for clusters in `~/.kube/config` | Cluster operations and access tests (via kubectl/helm sidecars)    |
| `127.0.0.1` / `localhost`                            | While the app runs                                                                    | Internal API routes and port-forwards                              |
| `github.com`, `release-assets.githubusercontent.com` | Every start                                                                           | Update check                                                       |
| `eu.i.posthog.com`                                   | Only after you allow usage telemetry                                                  | Usage events, see [the privacy notice](https://rozoom.app/privacy) |
| Cloud provider APIs                                  | When you use a provider CLI from the app                                              | Provider CLIs bundled in the full-offline build                    |
| Helm repository hosts                                | When you add a repository or install a chart                                          | Chart downloads via the helm sidecar                               |
| `fonts.googleapis.com`, `fonts.gstatic.com`          | Every start, releases up to and including 0.26.0                                      | Removed in 0.26.1. No font was loaded                              |

An exec plugin named in a kubeconfig is started by kubectl and makes its own connections.

### CLI tools (bundled sidecars)

ROZOOM runs its own bundled copies of these tools, not the ones on the system PATH. The slim build bundles only kubectl and Helm; the full-offline build bundles the rest. Each binary is allowlisted in the Tauri capability system:

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
- Connections: localhost and, for opt-in usage telemetry, the PostHog EU hosts
- No eval, no remote script loading

### Capability system

Tauri v2 capabilities (defined in `src-tauri/capabilities/default.json`) enforce least-privilege:

- **Shell**: allowlisted bundled tools, plus the platform shell (`sh`, `cmd`, `powershell`) for the debug terminal, which runs the commands you type
- **Filesystem**: scoped to specific directories (kubeconfig, cloud credentials, app data)
- **HTTP**: only localhost connections allowed

### DevTools

DevTools (F12 inspector) are disabled in production builds (`"devtools": false` in `tauri.conf.json`). In development mode, DevTools are available only when running via `cargo tauri dev` or `pnpm tauri:dev:rozoom` - Tauri enables them automatically for debug builds. Running with `pnpm dev` (Vite-only, no Tauri shell) does not provide F12 DevTools.

## Kubeconfig isolation

ROZOOM copies kubeconfig files to its own app data directory. This prevents:

- Accidental modification of the user's kubeconfig
- Conflicts with other tools modifying kubeconfig simultaneously
- Exposure of kubeconfig paths in process arguments

## Data storage

- Health check results are cached locally in the app data directory
- Cluster data, credentials and kubeconfig content are not part of usage telemetry
- Crash reporting is not configured in release builds: no Sentry DSN is set, and the CSP does not allow it

## Compliance posture

Suitable today for **internal dev-team use**: strong RBAC/PSS/hygiene checks,
restrictive CSP, SHA256-pinned bundled binaries, no telemetry unless you opt in.

Not yet suitable for **regulated environments** (SOC 2 Type II, ISO 27001,
PCI-DSS 4.0, HIPAA, FedRAMP). Known gaps and their compliance mapping:

| Gap                                      | Risk                         | Blocks                                                                                |
| ---------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| Plaintext kubeconfig on disk             | CRITICAL                     | PCI-DSS req 3, ISO 27001 A.10.1, SOC 2 CC6.1, FedRAMP SC-28, HIPAA §164.312(a)(2)(iv) |
| Audit log has no tamper protection       | HIGH                         | SOC 2 CC7.3, ISO 27001 A.12.4.2, FedRAMP AU-9                                         |
| `readOnly` flag not enforced everywhere  | MEDIUM                       | ISO 27001 A.9.4.1                                                                     |
| Bundled binaries verified only by SHA256 | MEDIUM                       | SLSA Level 3+                                                                         |
| Plugins not sandboxed                    | HIGH (when marketplace live) | OWASP ASVS V14                                                                        |
| No HTTP_PROXY / custom CA support        | MEDIUM                       | enterprise MITM proxies                                                               |
| No SIEM export                           | MEDIUM                       | SOC 2 CC7.2                                                                           |
| No app-level session lock                | MEDIUM                       | NIST 800-53 IA-11                                                                     |

Encrypted kubeconfig at rest (Tauri Stronghold or OS keyring) is the
highest-priority item and unlocks PCI-DSS, HIPAA, and SOC 2.

## Reporting security issues

If you discover a security vulnerability, please report it responsibly:

- Use [GitHub Private Vulnerability Reporting](https://github.com/ceh13-community/rozoom/security/advisories/new)
- Do not open a public GitHub issue for security vulnerabilities
