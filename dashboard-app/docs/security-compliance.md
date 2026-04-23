# Security & Compliance - KubeArmor, Compliance Hub, Trivy

Runtime security monitoring, compliance benchmarking, and vulnerability
scanning for Kubernetes clusters.

> **Looking for the app's own security posture** (how ROZOOM stores
> credentials, what it sends to Sentry, enterprise compliance status)?
> See [enterprise-readiness.md](enterprise-readiness.md).

---

## Pages

### KubeArmor Hub (437 lines)

KubeArmor runtime security integration:

- **Detection**: checks if KubeArmor is installed in the cluster
- **Install guidance**: step-by-step instructions when not detected
- **Status dashboard**: 5 summary cards showing:
  - KubeArmor agent status
  - Active security policies count
  - Alert summary (recent events)
  - Enforcement mode
  - Visibility mode
- **Alert feed**: recent security alerts from KubeArmor
- **Scan trigger**: on-demand security posture scan

### Compliance Hub (721 lines)

Kubernetes security compliance benchmarking:

- **Benchmark selection**: CIS Kubernetes Benchmark, NSA hardening guide
- **Scan execution**: runs compliance checks against selected framework
- **Results display**:
  - Pass / Fail / Warn counts with severity badges
  - Detailed finding list per check
  - Compliance score percentage
- **History**: previous scan results with timestamps
- **Namespace scoping**: scope scans to specific namespaces
- **Profile configuration**: customize scan parameters

### Trivy Hub (439 lines)

Container image vulnerability scanning:

- **Scan trigger**: on-demand vulnerability scan
- **Severity breakdown**: Critical, High, Medium, Low counts
- **Report display**: vulnerability list with:
  - CVE ID, severity, package, installed version, fixed version
  - Description and references
- **History**: previous scan results
- **Summary cards**: 5 diagnostic cards showing scan status and findings

### New in v0.17: Advanced Security Models

#### RBAC Risk Scanner (`rbac-risk-scanner.ts`)

Scans Roles/ClusterRoles for dangerous verb+resource combinations per [K8s RBAC best practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/):

| Risk Level   | Patterns                                                                         |
| ------------ | -------------------------------------------------------------------------------- |
| **CRITICAL** | Wildcard verbs/resources, escalate, bind, impersonate, nodes/proxy               |
| **HIGH**     | Secrets list/watch, pods/exec create, PV create, SA token create, webhook modify |
| **MEDIUM**   | Pods create (implicit secret access), namespace update                           |

Reports per-role risk score and cluster-wide summary. 9 tests.

#### PSS Compliance Checker (`pss-compliance.ts`)

Validates pods against [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/):

| Level          | Checks                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Baseline**   | hostNetwork, hostPID, hostIPC, hostPath volumes, privileged, host ports, dangerous capabilities, seccomp Unconfined |
| **Restricted** | runAsNonRoot, drop ALL capabilities, allowPrivilegeEscalation=false, seccompProfile RuntimeDefault/Localhost        |

Reports `maxCompliantLevel` per pod (privileged/baseline/restricted). 11 tests.

---

## Fleet Card Integration

Each security panel provides summary state consumed by fleet dashboard cards:

| Panel          | Store                | Fleet Card Display        |
| -------------- | -------------------- | ------------------------- |
| KubeArmor      | `armorHubState`      | Security status indicator |
| Compliance Hub | `complianceHubState` | Compliance status badge   |
| Trivy Hub      | `trivyHubState`      | Vulnerability summary     |

Summaries persist to health check cache for offline display.

---

## Architecture

```
$widgets/cluster/ui/
  armor-hub-panel.svelte             - KubeArmor dashboard (437 lines)
  compliance-hub-panel.svelte        - Compliance benchmarks (721 lines)
  trivy-hub-panel.svelte             - Vulnerability scanner (439 lines)

$features/
  armor-hub/model/
    store.ts                         - Scan state, polling (503 lines)
    store.test.ts                    - 2 tests
    types.ts                         - ArmorHubSummary, ArmorAlert types
  compliance-hub/model/
    store.ts                         - Benchmark state, history (1017 lines)
    store.test.ts                    - 9 tests
    types.ts                         - ComplianceScanResult, Finding types
  trivy-hub/model/
    store.ts                         - Scan state, reports (434 lines)
    store.test.ts                    - 3 tests
    types.ts                         - VulnerabilityReport, Severity types

Route wrappers:
  $widgets/datalists/ui/cluster-health/armor-hub-panel.svelte    - 11 lines
  $widgets/datalists/ui/cluster-health/compliance-hub-panel.svelte - 11 lines
  $widgets/datalists/ui/cluster-health/trivy-hub-panel.svelte    - 11 lines
```

### UI Pattern

All three panels follow an identical structure:

1. `Card.Root` wrapper with header and content sections
2. 5x `DiagnosticSummaryCard` components for status overview
3. `$effect`-driven auto-refresh on cluster ID change
4. Request ID guards for stale response rejection
5. Offline detection with graceful degradation

### Tests

```bash
pnpm vitest run src/lib/features/armor-hub/       # 2 tests
pnpm vitest run src/lib/features/compliance-hub/   # 9 tests
pnpm vitest run src/lib/features/trivy-hub/        # 3 tests
```

Total: 14 tests covering store logic, scan state, and history.
