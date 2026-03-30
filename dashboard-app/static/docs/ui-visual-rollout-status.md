# UI Visual Rollout Status

Date: 2025-09-05

## Stopping Point

The visual-system rollout is at a stable checkpoint.

Unified so far:

- main section tables for `WORKLOADS`, `NAMESPACE`, `CONFIGURATION`, `ACCESS CONTROL`, `CUSTOM RESOURCES`, `NETWORK`, `STORAGE`
- `Pods`
- `Nodes status`
- `Nodes Pressures`
- `Pod restarts`
- `CronJobs Monitoring`
- `Global Triage`
- bounded workbench panels
- cluster diagnostic panels:
  - `Metrics Sources`
  - `Alerts Hub`
  - `Version Audit`
  - `Deprecation Scan`
- remaining cluster/ops panels now aligned to the same shell primitives:
  - `Backup Audit`
  - `Helm`
  - `Trivy`
  - `Compliance Hub`
  - `KubeArmor`
- route-specific utility panels now aligned:
  - `Access Reviews`
  - `Port Forwarding`

Shared primitives now in place:

- `table-summary-bar.svelte`
- `table-surface.svelte`
- `table-empty-state.svelte`
- `workbench-panel-surface.svelte`
- `diagnostic-summary-card.svelte`
- `workbench-sheet-shell.svelte`

## Latest Commits In This Wave

- `04f3acc` `refactor(ui): unify cluster diagnostic panel shells`
- `0eb6e1f` `feat(ui): align observability and triage table shells`
- `2670756` `refactor(ui): unify workbench panel surfaces`
- `9a80305` `feat(ui): align node pressure table shell`
- `5b386cc` `feat(ui): align nodes status table shell`
- `cf54d4e` `feat(ui): align legacy namespace table shell`

## Validation State

- `svelte-check`: `0 errors, 0 warnings`
- focused visual/runtime contract packs used during this wave are green
- targeted panel test pack is green:
  - `helm-panel`
  - `trivy-hub-panel`
  - `armor-hub-panel`
  - `compliance-hub-panel`
- route utility panel pack is green:
  - `access-reviews-panel`
  - `port-forwarding-panel`
- targeted workbench sheet pack is green:
  - `pod-workbench-panel`
  - `workload-simple-workbench`
  - `resource-details-sheet.expand`

## Remaining Likely Legacy Surfaces

After the bounded cluster/ops and utility-panel cleanup, the remaining legacy surfaces are mostly interaction-heavy sheets:

- older deep detail sheets outside the bounded list family
- pod log / yaml / events sheets now share a common outer shell, so the remainder is narrower than before
- large inspector sheets such as `resource-details-sheet`, `pods-list/data-sheet`, and `nodes-list/data-sheet`
- any remaining visually acceptable bespoke wrappers where standardizing the shell would not materially simplify the code

## Recommended Next Step

Stop broad rollout work here.

If more cleanup is needed later, do a separate interaction-focused pass for the large sheet surfaces instead of mixing it back into table/panel shell work.

The best candidate for any future work is not another shell pass, but targeted simplification inside the large inspector sheets if they become hard to maintain.
