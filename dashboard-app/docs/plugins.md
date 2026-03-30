# Plugins

ROZOOM uses a plugin architecture to organize features into installable modules.
Core features are always available. Pro plugins include a 14-day free trial.

---

## For Users

### Plugin Tiers

| Tier          | Description                                                       | Disable? |
| ------------- | ----------------------------------------------------------------- | -------- |
| **Core**      | Cluster management, health checks, workload browser, Helm catalog | No       |
| **Free**      | Fleet organization, fix templates, workload visualizer            | Yes      |
| **Pro**       | Security, capacity, performance, auth, GitOps (14-day trial)      | Yes      |
| **Community** | Third-party plugins from marketplace                              | Yes      |

### Available Plugins

| Plugin                | Tier | Price  | What it does                                               |
| --------------------- | ---- | ------ | ---------------------------------------------------------- |
| Cluster Manager       | Core | Free   | Add, organize, manage clusters with 5 auth methods         |
| Health Checks         | Core | Free   | 37 automated checks: API server, etcd, nodes, pods, certs  |
| Workload Browser      | Core | Free   | Browse 61 K8s resource types with YAML editor, logs, shell |
| Helm Catalog          | Core | Free   | 25 curated charts with one-click install                   |
| Fleet Organization    | Free | Free   | Custom groups, smart groups, saved views                   |
| Fix Templates         | Free | Free   | YAML generators for PDB, NetworkPolicy, quota, probes      |
| Workload Visualizer   | Free | Free   | Dependency map: Ingress -> Service -> Deployment -> Pod    |
| Security Suite        | Pro  | $9/mo  | RBAC risk scanner, PSS compliance, credential hygiene      |
| Capacity Intelligence | Pro  | $9/mo  | Resource heatmap, bin-packing score, cost analysis         |
| Performance Suite     | Pro  | $9/mo  | RED metrics, CPU throttling, SLO tracking                  |
| Enterprise Auth       | Pro  | $12/mo | OIDC wizard, Vault integration, auth detection             |
| GitOps Integration    | Pro  | $5/mo  | ArgoCD and Flux bootstrap with generated YAML              |

### Managing Plugins

1. Open a cluster -> Cluster Ops sidebar -> **Plugins**
2. Filter by tier or category
3. Toggle Enable/Disable per plugin
4. Pro plugins start with 14-day free trial automatically

---

## For Developers

### Plugin Architecture

```
shared/plugins/
  types.ts           - PluginManifest, tiers, pricing, licensing types
  registry.ts        - Built-in plugin catalog (12 plugins)
  feature-flags.ts   - Activation logic, trial, license persistence
  index.ts           - Barrel export

  contrib/           - Community plugin examples
    workload-visualizer/
      model.ts       - buildDependencyGraph() pure function
      model.test.ts  - 7 tests
      visualizer-panel.svelte  - UI component
```

### Plugin Manifest

Every plugin is described by a `PluginManifest`:

```typescript
type PluginManifest = {
  id: string;              // unique identifier
  name: string;            // display name
  version: string;         // semver
  description: string;     // what it does
  author: string;          // author or organization
  tier: "core" | "free" | "pro" | "community";
  category: "security" | "observability" | "capacity" | ...;
  license: string;         // e.g. "Apache-2.0"
  pricing?: {
    type: "free" | "monthly" | "yearly";
    amount?: number;
    currency?: string;
    trialDays?: number;
  };
  provides: {
    workloadPages?: Array<{ id, label, section, description }>;
    healthChecks?: string[];
    helmCharts?: string[];
    analysisModules?: string[];
    dashboardWidgets?: string[];
  };
};
```

### Creating a Plugin

1. Create a directory under `shared/plugins/contrib/{plugin-name}/`
2. Add `model.ts` with a pure function (input -> result)
3. Add `model.test.ts` with tests
4. Add a Svelte panel component
5. Register in `registry.ts` with a `PluginManifest`
6. Add route wrapper in `widgets/datalists/ui/cluster-health/`
7. Register the workload type in:
   - `shared/model/workloads.ts` (WorkloadType union)
   - `widgets/workload/model/workload-route-registry.ts` (lazy import)
   - `pages/cluster/model/cluster-page-workspace.ts` (VALID_WORKLOADS)
   - `pages/cluster/model/cluster-page-workload-config.ts` (labels + non-namespace-scoped)
   - `routes/dashboard/clusters/[slug]/+page.ts` (VALID_WORKLOADS)
   - `shared/config/kubectl-commands.ts` (kubectl command mapping)
   - `widgets/menu/ui/workloads.svelte` (sidebar menu item)

### Example: Workload Visualizer

The included Workload Visualizer is a reference community plugin:

**Model** (`model.ts`):

- `buildDependencyGraph(resources)` - pure function
- Input: K8s resources (ingresses, services, deployments, pods, configmaps, secrets, pvcs, serviceaccounts, hpas)
- Output: `DependencyGraph` with nodes, edges, and summary
- Edge types: routes-to, selects, mounts, uses, scales, secures

**UI** (`visualizer-panel.svelte`):

- Fetches live data via `kubectlJson()` for 12 resource types
- Color-coded node grid by resource kind
- Kind filter with counts
- Click-to-select with connection detail
- Namespace scoping
- Refresh button

**Tests** (`model.test.ts`):

- 7 tests covering graph building, status detection, HPA scaling, orphan detection

### Feature Flags

Check if a feature is available before rendering:

```typescript
import { isFeatureAvailable, isPluginActive } from "$shared/plugins";

// Check by feature ID (workload page, health check, etc.)
if (isFeatureAvailable("securityaudit")) { ... }

// Check full plugin
import { getPluginById } from "$shared/plugins";
const plugin = getPluginById("security-suite");
if (plugin && isPluginActive(plugin)) { ... }
```

### Testing

```bash
# Plugin system tests
pnpm vitest run src/lib/shared/plugins/

# Specific plugin tests
pnpm vitest run src/lib/shared/plugins/contrib/workload-visualizer/
```
