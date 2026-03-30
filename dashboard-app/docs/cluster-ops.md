# Cluster Ops - Helm, Deprecation Scan, Version Audit, Backup, Certificate Rotation

Operational tooling for cluster lifecycle: Helm release management,
API deprecation detection, chart version auditing, and Velero-based
backup management.

---

## Pages

### Helm (668 lines)

Full Helm lifecycle management:

**Releases:**

- List all Helm releases with status badges (deployed, failed, pending)
- Release actions: Upgrade, Uninstall, Rollback
- Release inspection: Status JSON, History, Values, Manifest, Test logs
- Install new chart from repository

**Repositories:**

- List configured Helm repos
- Add / Remove repos
- Repo status display

**Refresh:** Auto-refreshes on section enter (30s cooldown), manual refresh button.

### API Deprecation Scan (526 lines)

Detects deprecated and removed Kubernetes API usage via Pluto:

- **Quick scan**: checks in-cluster resources for deprecated APIs
- **Full scan**: comprehensive scan including Helm releases
- Issue list sorted by severity with:
  - Resource kind, name, namespace
  - Deprecated API version → replacement version
  - Removal target K8s version
  - Request count (if available)
- Auto-refresh with page visibility gating
- History of previous scan runs

### Cluster Version & Helm Audit (337 lines)

Checks Helm chart versions against latest available:

- Chart name, current version, latest version
- Status badges: up-to-date, outdated, unknown
- Grouped by status (outdated first)
- Auto-refresh with page visibility gating
- History tracking

### Cluster Backup Status (1107 lines)

Velero-based backup management:

- **Velero detection**: checks if Velero is installed, shows install guidance
- **Backup list**: existing backups with status, timestamps, size
- **Create backup**: on-demand backup creation with namespace selection
- **Restore**: restore from backup with confirmation
- **Schedule management**: view and manage backup schedules
- **Download**: download backup artifacts
- Auto-refresh with page visibility gating
- Velero profile detection (bundled CLI)

**Supported cloud providers for backup storage:**

| Provider                 | Plugin                                    | Storage        | Snapshots       | Auth                                      |
| ------------------------ | ----------------------------------------- | -------------- | --------------- | ----------------------------------------- |
| AWS (S3)                 | velero-plugin-for-aws v1.13.1             | S3 bucket      | EBS snapshots   | IRSA role ARN or static keys              |
| Azure                    | velero-plugin-for-microsoft-azure v1.13.0 | Blob container | Azure snapshots | Client credentials (id/secret/tenant)     |
| GCP (GCS)                | velero-plugin-for-gcp v1.13.0             | GCS bucket     | GCE snapshots   | Workload identity or service account JSON |
| DigitalOcean (Spaces)    | velero-plugin-for-aws v1.13.1             | S3-compatible  | Disabled        | Access key + secret key                   |
| Hetzner (Object Storage) | velero-plugin-for-aws v1.13.1             | S3-compatible  | Disabled        | S3 access key + secret key                |

**Hetzner Object Storage specifics:**

- Endpoint format: `https://<dc>.your-objectstorage.com` (fsn1, nbg1, hel1)
- Region value = datacenter code (fsn1, nbg1, hel1), not AWS-style regions
- Path-style addressing required (s3ForcePathStyle=true)
- checksumAlgorithm disabled (aws-sdk-go-v2 CRC32 not supported)
- Credentials: per-project S3 keys from Hetzner Cloud Console

### Rotate Certificates

TLS certificate lifecycle management for control-plane and kubelet certificates.

**Certificate scan:**

- Control-plane certificate list with expiry dates and days remaining
- Status per cert: OK (>30d), Warning (<30d), Critical (expired)
- Kubelet rotation status per node (client + server rotation flags)

**CSR management:**

- Lists all Certificate Signing Requests (CSRs) in the cluster
- Highlights pending CSRs that need approval
- One-click "Approve All" for pending CSRs

**Rotation strategies (distribution-aware):**

The panel auto-detects cluster distribution and applies the appropriate rotation strategy:

| Distribution    | Strategy                                                  | Auto-rotate |
| --------------- | --------------------------------------------------------- | ----------- |
| kubeadm         | `kubeadm certs renew all` via exec into control-plane pod | Yes         |
| OpenShift       | `oc adm certificate approve` via CSR approval             | Yes         |
| K3s             | Restart k3s/k3s-agent service (manual)                    | No          |
| RKE2            | Restart rke2-server/rke2-agent service (manual)           | No          |
| Minikube        | `minikube stop && minikube start` (manual)                | No          |
| Kind            | Recreate cluster (manual)                                 | No          |
| K3d             | Stop and start cluster (manual)                           | No          |
| Docker Desktop  | Reset Kubernetes in settings (manual)                     | No          |
| Rancher Desktop | Reset Kubernetes in preferences (manual)                  | No          |
| Colima          | `colima stop && colima start` (manual)                    | No          |
| AWS EKS         | Managed by AWS - automatic                                | N/A         |
| GKE             | Managed by Google - automatic                             | N/A         |
| AKS             | Managed by Azure - automatic                              | N/A         |
| DigitalOcean    | Managed by DigitalOcean - automatic                       | N/A         |
| Hetzner         | Managed by Hetzner - automatic                            | N/A         |
| Oracle OKE      | Managed by Oracle - automatic                             | N/A         |

**Multi-strategy fallback:** kubeadm exec -> CSR approval -> manual instructions.

### Helm Catalog - New Charts (v0.17)

8 new charts added to the curated catalog (25 total across 5 categories):

| Chart                         | Category       | Description                                           |
| ----------------------------- | -------------- | ----------------------------------------------------- |
| **OpenCost**                  | Observability  | Real-time cost monitoring by namespace/label/workload |
| **External Secrets Operator** | Security       | Sync secrets from Vault/AWS SM/GCP SM/Azure KV        |
| **OpenTelemetry Collector**   | Observability  | Vendor-neutral traces/metrics/logs pipeline           |
| **Ingress NGINX**             | Networking     | Production-grade ingress controller                   |
| **ArgoCD**                    | Infrastructure | GitOps continuous delivery                            |
| **Flux2**                     | Infrastructure | GitOps toolkit with Helm/OCI support                  |
| **Prometheus Adapter**        | Autoscaling    | Custom Prometheus metrics for HPA                     |

### GitOps Bootstrap (v0.17)

One-click GitOps setup with YAML generators:

- **ArgoCD**: Application CRD with automated sync + self-heal
- **Flux**: GitRepository source + Kustomization with pruning
- Configurable repo URL, branch, path, namespace (`gitops-bootstrap.ts`)

### Fix Templates (v0.17)

YAML template generator for "Fix this" actions from health checks:

| Template                   | Category | What it generates                      |
| -------------------------- | -------- | -------------------------------------- |
| PodDisruptionBudget        | HA       | minAvailable PDB with label selector   |
| Default-deny NetworkPolicy | Security | Deny all + DNS exception               |
| ResourceQuota              | Capacity | CPU/memory/pod limits per namespace    |
| LimitRange                 | Capacity | Default container resource specs       |
| Readiness/Liveness probes  | Health   | HTTP probe snippets with safe defaults |
| SecurityContext            | Security | Non-root, read-only FS, drop ALL caps  |

---

## Architecture

```
$widgets/cluster/ui/
  helm-panel.svelte                      - Helm release + repo management
  deprecation-scan-panel.svelte          - Pluto deprecation scanner
  deprecation-scan-summary.svelte        - Summary badge for fleet cards
  version-audit-panel.svelte             - Chart version checker
  version-audit-summary.svelte           - Summary badge for fleet cards
  backup-audit-panel.svelte              - Velero backup manager
  backup-audit-summary.svelte            - Summary badge for fleet cards
  rotate-certs-panel.svelte              - Certificate rotation + CSR approval

$features/
  deprecation-scan/model/store.ts        - Scan state, polling, history (1228 lines)
  version-audit/model/store.ts           - Audit state, polling (401 lines)
  backup-audit/model/store.ts            - Backup state, Velero integration (888 lines)
  backup-audit/model/velero-profile.ts   - Velero CLI detection (152 lines)

Thin route wrappers in:
  $widgets/datalists/ui/cluster-health/  - 11-line wrappers per panel
```

### Summary Badges on Fleet Cards

Each cluster ops panel provides a summary badge displayed on fleet dashboard cards:

- **Deprecation scan**: "X deprecated" with warning/critical severity
- **Version audit**: "X outdated" or "up to date"
- **Backup status**: "last backup X ago" or "no backups"

These summaries are computed by dedicated `*-summary.svelte` components
and driven by background polling with configurable intervals.

---

## Tests

```bash
pnpm vitest run src/lib/features/deprecation-scan/    # 8 tests
pnpm vitest run src/lib/features/version-audit/       # 4 tests
pnpm vitest run src/lib/features/backup-audit/        # 16 tests
pnpm vitest run src/lib/widgets/cluster/ui/helm-panel  # 5 tests
```

Total: 36 tests covering store logic, polling, Helm operations, and route gating.
