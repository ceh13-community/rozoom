# Access Control - RBAC Resource Pages

Manages Kubernetes RBAC resources with risk-scored visibility and
interactive access review testing.

---

## Pages

### RBAC Resources (via `configuration-list.svelte`)

| Resource                  | Key Columns                    | RBAC Scoring                            |
| ------------------------- | ------------------------------ | --------------------------------------- |
| **Service Accounts**      | Name, Namespace, Age           | Secrets + pull secrets count            |
| **Roles**                 | Name, Namespace, Age           | Rules count + wildcard/secret/exec risk |
| **Role Bindings**         | Name, Namespace, Bindings, Age | Subjects + roleRef + cluster-admin risk |
| **Cluster Roles**         | Name, Age                      | Rules count + wildcard/secret/exec risk |
| **Cluster Role Bindings** | Name, Bindings, Age            | Subjects + roleRef + cluster-admin risk |

### Access Reviews (dedicated panel)

Interactive `kubectl auth can-i` checker:

- **Namespace**: scope for the review
- **Verb**: get, list, create, update, delete, etc.
- **Resource**: pods, deployments, secrets, etc.
- **Resource name**: specific resource (optional)
- **Subresource**: log, exec, portforward (optional)
- **As user**: impersonate service account or user (optional)
- **As group**: impersonate group (optional)
- Live **command preview** that updates as fields change
- **Copy kubectl** button for sharing
- Result displayed inline (yes/no/error)

---

## RBAC Risk Scoring

Each role, binding, and cluster-scoped resource gets a risk score:

| Finding                                             | Score | Severity |
| --------------------------------------------------- | ----- | -------- |
| Wildcard access (verbs/resources/apiGroups `*`)     | +240  | Critical |
| Binding to `cluster-admin`                          | +260  | Critical |
| `system:unauthenticated` group in binding           | +220  | Critical |
| Impersonation capability                            | +210  | Critical |
| Interactive pod access (`pods/exec`, `pods/attach`) | +190  | Critical |
| Secret read access (`get`/`list`/`watch` secrets)   | +170  | Warning  |
| Binding with no subjects                            | +140  | Warning  |

Risk score is displayed in the details sheet and used for problem-first
sorting in the table.

---

## Action Menu

All Access Control resources use a unified sectioned menu:

| Section         | Actions                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| **(top)**       | Show details                                                                   |
| **Manifest**    | Edit YAML, Copy kubectl get -o yaml, Copy kubectl describe, Run debug describe |
| **Diagnostics** | Investigate (optional)                                                         |
| **Dangerous**   | Delete                                                                         |

Consistent across: row ⋮ menu, details sheet, bulk selection bar.

---

## Details Sheet

Shows for each RBAC resource:

- Namespace, Kind, Subjects, Rules, Summary, Age, Name
- Labels and Annotations
- RBAC risk score and severity (for Roles/Bindings)
- Action buttons matching the row menu

---

## For Developers

### Architecture

```
$widgets/datalists/ui/access-control/
  access-control-list.svelte              - Table with custom columns
  access-control-actions-menu.svelte      - Row action dropdown (sectioned)
  access-control-bulk-actions.svelte      - Bulk selection toolbar
  access-control-details-sheet.svelte     - Side panel details
  access-control-workbench-panel.svelte   - YAML workbench
  access-reviews-panel.svelte             - kubectl auth can-i checker
  model/
    access-control-row-adapter.ts         - Row type + data mapping

RBAC resources also route through configuration-list.svelte
(ServiceAccounts, Roles, RoleBindings, ClusterRoles, ClusterRoleBindings)
with dedicated renderers and risk evaluation in:
  configuration-list/model/resource-renderers.ts → evaluateRbacRisk()
```
