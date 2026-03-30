# Cluster Manager - Start Page

The Cluster Manager is the entry point of ROZOOM K8s Linter IDE.
It discovers your Kubernetes clusters, validates access, and lets you
add them to the dashboard - all from one screen.

---

## Page Sections

### Cloud Providers Panel

A collapsible panel at the top that shows three layers of detection:

| Section                            | What it shows                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Bundled Tools**                  | CLIs shipped inside the app (no OS install needed). Green check = binary runs. Version comes from the install manifest.   |
| **OS Tools (system PATH)**         | Same CLIs detected in your operating system via `which`/`where`. Blue check = found in PATH, with version and path shown. |
| **Detected Credentials & Configs** | Cloud provider config files found in your home directory (`~/.aws/`, `~/.kube/`, `~/.config/gcloud/`, etc.).              |

**Bundled tools** (14 total):

| Tool        | Category   | Purpose                                                     |
| ----------- | ---------- | ----------------------------------------------------------- |
| kubectl     | Core K8s   | Cluster operations, resource management                     |
| helm        | Core K8s   | Chart-based package management                              |
| kustomize   | Core K8s   | Manifest customization without templates                    |
| kubeconform | Validation | Validate YAML against K8s JSON schemas                      |
| pluto       | Validation | Detect deprecated Kubernetes API versions                   |
| stern       | Debug      | Multi-pod, multi-container log tailing                      |
| velero      | Backup     | Cluster backup and disaster recovery                        |
| yq          | YAML       | YAML/JSON processor for manifest transformations            |
| aws         | Cloud      | AWS CLI for EKS cluster management                          |
| gcloud      | Cloud      | Google Cloud SDK for GKE (not bundled - install separately) |
| doctl       | Cloud      | DigitalOcean CLI for DOKS                                   |
| hcloud      | Cloud      | Hetzner Cloud CLI                                           |
| oc          | Cloud      | OpenShift/OKD client                                        |
| az          | Cloud      | Azure CLI for AKS cluster management                        |

All binaries are downloaded and verified by `download-binaries.js` with
SHA-256 checksums (and PGP for AWS CLI). No system PATH dependencies -
the app is fully self-contained.

### Detected Kubeconfig Files

Scans standard kubeconfig locations (`~/.kube/config`) and shows every
context found:

- **Provider** auto-detected (AWS EKS, GKE, DigitalOcean, AKS, etc.)
- **Region** extracted from cluster ARN/URL
- **Auth method** shown (exec, token, certificate)
- **Status** validated (Ready, Auth issue, Unreachable)
- **Environment** auto-classified (prod, stage, dev, shared)

You can select individual clusters or add all at once.

### Managed Clusters

Clusters you've added to ROZOOM. Features:

- Filter by status (online/offline), provider, environment, name/tag
- Bulk actions (select all, remove selected)
- "Open Cluster Dashboard" button to enter the main IDE view

### Connect Cluster Wizard (v0.17)

Collapsible wizard on the Cluster Manager page with 5 auth methods:

| Method                | Security | What it does                                                                                  |
| --------------------- | -------- | --------------------------------------------------------------------------------------------- |
| **OIDC / SSO**        | High     | Azure AD, Okta, Keycloak, Google, Generic. Generates kubeconfig with kubelogin exec plugin.   |
| **Cloud Provider**    | High     | AWS EKS, GKE, AKS, DigitalOcean. Cross-region discovery, one-click import using bundled CLIs. |
| **HashiCorp Vault**   | High     | Dynamic credentials via token/kubernetes/OIDC/approle auth.                                   |
| **X.509 Certificate** | High     | Client cert + private key (base64 PEM). Mutual TLS.                                           |
| **Bearer Token**      | Medium   | Static or ServiceAccount token. Warning about no auto-rotation.                               |

Both "Connect Cluster" and "Cloud Providers" panels are collapsed by default.

### Enterprise Authentication (v0.17)

| Feature                       | Description                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth method detection**     | Auto-detect auth method per cluster: X.509, bearer token, exec plugin (aws/gcloud/az/kubelogin), OIDC, auth-provider. Security level grading (high/medium/low). (`auth-detection.ts`)                                                     |
| **Token expiry detection**    | Parse JWT tokens from kubeconfig, detect expiry timestamp. Warn on expired and expiring (< 24h) tokens. (`auth-detection.ts`)                                                                                                             |
| **Credential security audit** | Analyze credential storage risks: plaintext tokens/keys, insecure-skip-tls-verify, no rotation, deprecated methods. Score 0-100. (`credential-security.ts`)                                                                               |
| **OIDC/SSO wizard**           | Generate kubelogin exec config for Azure AD, Okta, Keycloak, Google, generic OIDC. Full kubeconfig generation. (`oidc-config.ts`)                                                                                                         |
| **Vault integration**         | HashiCorp Vault dynamic credentials: token/kubernetes/OIDC/approle auth, KV v1/v2, namespace support. (`vault-integration.ts`)                                                                                                            |
| **Auth & Credentials page**   | Cluster Ops sidebar page showing auth method, token status, credential storage findings with remediation.                                                                                                                                 |
| **Credential hygiene**        | File permission check (should be 0600), stale token detection, embedded key warnings, TLS verification. (`credential-hygiene.ts`) Ref: [K8s Secrets Best Practices](https://kubernetes.io/docs/concepts/security/secrets-good-practices/) |

### New in v0.17

| Feature                           | Description                                                                                                                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Real connection probe**         | Each detected cluster gets a real `kubectl cluster-info` ping with latency (ms) instead of name-based heuristic. Status updates asynchronously after page load. (`probe-connection.ts`)                                                   |
| **Cloud import one-click**        | List and import clusters from AWS EKS, GKE, AKS, DigitalOcean using bundled CLIs. AWS EKS supports cross-region discovery (all enabled regions scanned in parallel). AKS returns clusters across all resource groups. (`cloud-import.ts`) |
| **Soft-delete with restore**      | Removed clusters move to a trash list instead of permanent deletion. Restore or purge from trash. (`removedClustersList` store)                                                                                                           |
| **Default namespace per context** | Set a default namespace that auto-applies on cluster switch (before user overrides). Stored in `AppClusterConfig.defaultNamespace`.                                                                                                       |
| **Rename context**                | Rename cluster context in the stored kubeconfig file and update the app store. Rewrites context/cluster names in YAML. (`renameClusterContext()`)                                                                                         |
| **Kubeconfig merge/dedupe**       | Merge multiple kubeconfig files with automatic duplicate detection and conflict resolution. Reports all conflicts with source file tracking. (`kubeconfig-merge.ts`)                                                                      |
| **Catalog export/import**         | Export groups, tags, display names as JSON without secrets. Import on another machine. Versioned format with validation. (`catalog-export.ts`)                                                                                            |
| **Audit trail**                   | Records cluster management actions (add, remove, restore, rename, group changes) with timestamps. Capped at 500 entries. (`audit-trail.ts`)                                                                                               |

### Cloud Import

Import Kubernetes clusters directly from cloud provider APIs using bundled CLIs.
Requires valid cloud credentials (detected automatically from standard config paths).

| Provider         | CLI      | Cross-region | How it works                                                                                    |
| ---------------- | -------- | ------------ | ----------------------------------------------------------------------------------------------- |
| **AWS EKS**      | `aws`    | Yes          | Queries `ec2 describe-regions`, then `eks list-clusters --region X` in parallel for all regions |
| **GKE**          | `gcloud` | Yes (native) | `gcloud container clusters list` is project-wide (all zones/regions)                            |
| **AKS**          | `az`     | Yes (native) | `az aks list` returns all clusters across all resource groups and regions in the subscription   |
| **DigitalOcean** | `doctl`  | Yes (native) | `doctl kubernetes cluster list` returns all clusters globally                                   |

**AWS EKS cross-region flow:**

1. `aws ec2 describe-regions --filters opt-in-status` - lists all enabled regions
2. For each region: `aws eks list-clusters --region <region>` (parallel)
3. Results are merged and displayed with region labels

If a specific region is provided (via Connect Cluster Wizard), only that region is queried.

**AKS resource group handling:**

`az aks list` returns `location` (region) and `resourceGroup` separately.
The import uses `az aks get-credentials --name X --resource-group Y` with the correct
resource group, not the location.

---

## For Developers

### Architecture

```
cluster-manager.svelte          - Page component (UI + state)
$features/cluster-finder/
  api/cli-detection.ts          - Bundled/OS tool probing + cloud config detection
  model/cli-store.ts            - Svelte stores + manifest loading
$shared/config/tooling.ts       - TOOL_REGISTRY (single source of truth)
$shared/api/cli.ts              - Tauri sidecar/resource command creation
```

### Tool Registry

All tool definitions live in `$shared/config/tooling.ts` → `TOOL_REGISTRY`.
To add a new tool:

1. Add entry to `TOOL_REGISTRY` with `status: "bundled"` or `"planned"`
2. Add download function in `download-binaries.js`
3. Add to `externalBin` in `tauri.conf.json` (or `resources` for non-binary tools)
4. Add sidecar permissions in `capabilities/default.json`
5. Add to `CliTool` type in `$shared/api/cli.ts`
6. Run `node download-binaries.js`

### Tool Selection (Build-Time Filter)

Use `VITE_ROZOOM_TOOLS` to bundle only specific tools. Disabled tools
are not downloaded, not shown in the UI, and not probed at runtime.

```bash
# Bundle only core K8s tools (no cloud CLIs):
VITE_ROZOOM_TOOLS=kubectl,helm,kustomize,kubeconform,pluto,stern,yq node download-binaries.js

# Bundle everything (default when unset):
node download-binaries.js
```

The same variable works for both `download-binaries.js` (controls which
binaries are downloaded) and the Vite build (controls which tools appear
in the frontend). Set it in `.env.local` for persistent configuration.

### Version Pinning

Versions are pinned via environment variables:

```bash
KUBECTL_VERSION=v1.35.3 node download-binaries.js
```

See `.env.example` for the full list. Without pins, latest versions are
downloaded from GitHub Releases.

### Manifest

`src-tauri/binaries/.install-manifest.json` tracks downloaded versions,
SHA-256 hashes, and timestamps. A copy at `static/binaries/install-manifest.json`
is served to the frontend for instant version display.

### FS Permissions

The app has scoped filesystem access (defined in `capabilities/default.json`):

- **Read-only**: `~/.aws/`, `~/.config/gcloud/`, `~/.azure/`, `~/.config/doctl/`,
  `~/.config/hcloud/`, `~/.hcloud/`, `~/.kube/` - for cloud config detection
- **Read-write**: App directories (AppData, AppConfig, etc.), `~/Downloads/`, temp
- Files selected via the native file dialog get temporary scope automatically

### Theme

Dark theme is the default. User preference is persisted in `localStorage`.
Three themes available: Light, Dark, K9s.
