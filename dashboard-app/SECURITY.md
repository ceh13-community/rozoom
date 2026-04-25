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
- Sentry error tracking (optional) sends crash reports only. The SDK is
  configured to exclude cluster data, credentials, and kubeconfig content
  by design, but automated scrubbing is still being hardened (see
  Phase 8.2 below). Until that work lands, treat Sentry telemetry as a
  best-effort carve-out rather than an enforced guarantee.

## Compliance posture

Suitable today for **internal dev-team use**: strong RBAC/PSS/hygiene checks,
restrictive CSP, per-file 0600 permissions, SHA256-pinned bundled binaries,
no external telemetry beyond optional Sentry.

Not yet suitable for **regulated environments** (SOC 2 Type II, ISO 27001,
PCI-DSS 4.0, HIPAA, FedRAMP). Known gaps, their compliance mapping, and the
planned hardening are tracked as **Phase 8** in [`ROADMAP.md`](../ROADMAP.md):

| Gap                                      | Risk                         | Blocks                                                                                |
| ---------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| Plaintext kubeconfig on disk             | CRITICAL                     | PCI-DSS req 3, ISO 27001 A.10.1, SOC 2 CC6.1, FedRAMP SC-28, HIPAA §164.312(a)(2)(iv) |
| Sentry without credential scrubbing      | HIGH                         | GDPR Art. 32, SOC 2 CC6.7                                                             |
| Audit log has no tamper protection       | HIGH                         | SOC 2 CC7.3, ISO 27001 A.12.4.2, FedRAMP AU-9                                         |
| `readOnly` flag not enforced             | MEDIUM                       | ISO 27001 A.9.4.1                                                                     |
| No signed auto-update                    | HIGH                         | NIST SSDF PS.2, US EO 14028                                                           |
| Bundled binaries verified only by SHA256 | MEDIUM                       | SLSA Level 3+                                                                         |
| Plugins not sandboxed                    | HIGH (when marketplace live) | OWASP ASVS V14                                                                        |
| No HTTP_PROXY / custom CA support        | MEDIUM                       | enterprise MITM proxies                                                               |
| No SIEM export                           | MEDIUM                       | SOC 2 CC7.2                                                                           |
| No app-level session lock                | MEDIUM                       | NIST 800-53 IA-11                                                                     |

Phase 8.1 (encrypted kubeconfig at rest via Tauri Stronghold or OS keyring)
is the single highest-priority item and unlocks PCI-DSS, HIPAA, and SOC 2.

## Reporting security issues

If you discover a security vulnerability, please report it responsibly:

- Email: udawpk@gmail.com
- Do not open a public GitHub issue for security vulnerabilities
