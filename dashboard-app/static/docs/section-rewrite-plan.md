# Section Rewrite Plan

Date: 2024-08-15

Checkpoint:

- `PR1` runtime contract scaffold is in place:
  - section runtime contract types
  - family workload registry for `CONFIGURATION / NETWORK / STORAGE`
  - shared section summary helper
  - current `configuration-core`, `network`, and `storage` list surfaces already consume the shared summary contract

## Decision

The next substantial phase should be a bounded rewrite wave for `CONFIGURATION`, `NETWORK`, and `STORAGE`.

Do not spend more time on broad visual cleanup first.

## What Is Already Closed

- Visual shell rollout for the main table and panel surfaces is closed enough to stop broad UI-shell rewrites.
- Route utility panels are no longer the main blocker:
  - `Access Reviews`
  - `Port Forwarding`
- Pod workbench sheets now share a common outer shell.
- `pods-lite-list.svelte` is not carrying an active `svelte-check` warning at this checkpoint.
- Runtime foundation already exists for scale-oriented work:
  - request scheduler
  - stale cache hydration
  - in-flight dedupe
  - bounded prefetch
  - sync status and workload telemetry

## What Is Not Closed

- Product parity across major sections is still uneven.
- `cluster-page.svelte` still owns too much orchestration.
- `workload-display.svelte` is still a routing hub for too many unrelated domains.
- `CONFIGURATION`, `NETWORK`, and `STORAGE` still depend on shared family components instead of clear per-section boundaries.
- FSD layering exists, but is still closer to FSD-shaped than strictly enforced FSD.

## Current Section Map

### `CONFIGURATION`

Current paths:

- [configuration-list.svelte](src/lib/widgets/datalists/ui/configuration-list.svelte)
- [configuration-core-list.svelte](src/lib/widgets/datalists/ui/configuration/configuration-core-list.svelte)

Current split:

- `namespaces` now use a dedicated bounded operational list path
- many core configuration resources already route to `configuration-core-list.svelte`

Main problem:

- behavior ownership is split inconsistently between a very heavy generic path and a very light summary path
- details/actions/perf boundaries are not normalized

### `NETWORK`

Current path:

- [network-list.svelte](src/lib/widgets/datalists/ui/network/network-list.svelte)

Covered workloads:

- `services`
- `endpoints`
- `ingresses`
- `ingressclasses`
- `gatewayclasses`
- `gateways`
- `httproutes`
- `referencegrants`
- `networkpolicies`

Main problem:

- all network resources share one behavior owner even though operational models are very different
- `Services` and `Gateway API` resources should not be coupled this tightly

### `STORAGE`

Current path:

- [storage-list.svelte](src/lib/widgets/datalists/ui/storage/storage-list.svelte)

Covered workloads:

- `persistentvolumeclaims`
- `persistentvolumes`
- `storageclasses`

Main problem:

- PVC, PV, and StorageClass share selection/actions/details patterns even though they have different runtime and operational concerns

## Rewrite Goal

Replace shared family behavior ownership with section-specific bounded implementations while keeping a small amount of shared table/workbench plumbing.

The goal is not three giant rewrites.

The goal is:

- a stable section contract
- isolated section runtime
- clear details and workbench boundaries
- bounded request and enrichment behavior
- lower orchestration pressure in `cluster-page.svelte` and `workload-display.svelte`

## Non-Goals

- No visual-system broad rewrite
- No mass redesign of all details sheets
- No attempt to reach full Lens parity in one wave
- No all-at-once migration of every workload away from `workload-display.svelte`

## Hard Constraints

- `svelte-check` must stay green throughout the wave
- section rewrites must ship in reviewable PR slices
- default table views must stay snapshot-first and cheap
- details/workbench logic must not leak back into base row rendering
- cluster switching and prefetch behavior must stay bounded

## Section Contract To Introduce First

Before splitting section implementations further, define one minimal contract for section runtimes.

Each section implementation should own:

- row adapter
- filter/query model
- selection model
- row actions and bulk actions
- details boundary
- optional workbench boundary
- sync/cache summary state

Each section implementation should not own:

- route switching
- cluster workspace orchestration
- generic workload routing for unrelated domains

## PR Sequence

### `PR1` Section Runtime Contract

Target:

- shared contract only, no major behavior rewrite yet

Deliverables:

- section runtime interface for `CONFIGURATION`, `NETWORK`, `STORAGE`
- common table shell and summary-strip usage rules
- shared sync/cache banner contract
- shared details/workbench boundary contract

Primary files likely touched:

- [workload-display.svelte](src/lib/widgets/workload/ui/workload-display.svelte)
- new `features/*` section runtime helpers
- section-local model folders

Done when:

- each family can be migrated without inventing new runtime shape per PR

Status:

- done at the scaffold level

### `PR2` Configuration Boundary Split

Target:

- stop treating configuration as one ambiguous family

Deliverables:

- separate `Namespaces` runtime from generic configuration behavior
- keep lightweight core resources on a bounded path
- define explicit groups:
  - lightweight config data
  - policy/config control resources
  - namespace operational view

Recommended split:

- `Namespaces`: dedicated operational section
- `Core Configuration`: `configmaps`, `resourcequotas`, `limitranges`, `leases`
- `Policy/Control Config`: `horizontalpodautoscalers`, `poddisruptionbudgets`, `priorityclasses`, `runtimeclasses`, webhook configs
- `Secrets`: own UX policy, even if still technically implemented close to core config

Done when:

- `Namespaces` no longer rely on the heavy generic configuration path
- `Secrets` stop being “just another config row”

Status:

- `namespaces` routing is split out to a dedicated bounded list
- `secrets` routing is split out to a dedicated metadata-only boundary
- policy/control resources are split out to a dedicated bounded list
- `CONFIGURATION` still has follow-up cleanup only if we later want stricter entity/feature extraction

### `PR3` Network Boundary Split

Target:

- break `network-list.svelte` into bounded implementations by operational model

Recommended split:

- `Services and Endpoints`
- `Ingress and IngressClass`
- `Gateway API`: `gatewayclasses`, `gateways`, `httproutes`, `referencegrants`
- `Network Policies`

Deliverables:

- per-group row models
- per-group details/actions logic
- `Services` retain workbench/open-web flows without making the rest of network carry that weight

Done when:

- `Services` behavior no longer defines the shape of the whole network family
- `Gateway API` resources have an explicit section boundary

Status:

- `services` and `endpoints` stay on the interactive `network-list` boundary
- `ingresses` and `ingressclasses` route through a dedicated ingress summary boundary
- `gateway api` resources route through a dedicated gateway summary boundary
- `networkpolicies` route through a dedicated policy summary boundary

### `PR4` Storage Boundary Split

Target:

- separate claims, volumes, and classes into bounded runtime ownership

Recommended split:

- `Persistent Volume Claims`
- `Persistent Volumes`
- `Storage Classes`

Deliverables:

- explicit binding-state and attachment summaries
- details views focused on storage concerns, not generic row reuse
- YAML/workbench flows only where they make operational sense

Done when:

- PVC / PV / StorageClass logic is no longer carried by one list owner

Status:

- `persistentvolumeclaims` stay on the interactive storage boundary
- `persistentvolumes` route through a dedicated summary boundary
- `storageclasses` route through a dedicated summary boundary

### `PR5` Cluster Page Orchestration Reduction

Target:

- reduce page-level orchestration after new section boundaries exist

Deliverables:

- move more section bootstrap rules out of [cluster-page.svelte](src/lib/pages/cluster/ui/cluster-page.svelte)
- move section-specific navigation/runtime policy out of [workload-display.svelte](src/lib/widgets/workload/ui/workload-display.svelte)
- keep `cluster-page` focused on workspace, routing, and global page state only

Done when:

- page-level orchestration surface is smaller and section ownership is clearer

Status:

- workload route registry and props policy are moved out of `workload-display.svelte`
- `workload-display.svelte` is reduced to load/render/telemetry orchestration
- `cluster-page.svelte` still remains the larger pending orchestration owner

### `PR6` Scale Validation Pass

Target:

- verify that the new boundaries did not regress multi-cluster behavior

Deliverables:

- cluster-switch timing check
- prefetch concurrency review
- scheduler wait review
- per-section refresh budget review
- cache-hit and stale-hit review for rewritten sections

Done when:

- rewritten sections are validated as bounded under multi-cluster scenarios

Status:

- local cluster-switch/cache/runtime contract pack is green
- route-family rewrites did not regress existing watcher/cache contracts in local verification
- live `50-100` cluster soak validation still remains an external follow-up, not something proven by local repo tests alone

## Priority Order Inside Each Section

### `CONFIGURATION`

Priority:

1. `namespaces`
2. `secrets`
3. policy/control resources
4. remaining lightweight configuration rows

Reason:

- biggest UX mismatch and architecture mismatch live here

### `NETWORK`

Priority:

1. `services`
2. `gateway api` resources
3. `ingress` resources
4. `networkpolicies`
5. `endpoints`

Reason:

- `services` carry the most operational UX weight
- gateway resources deserve a first-class boundary instead of generic list coupling

### `STORAGE`

Priority:

1. `persistentvolumeclaims`
2. `persistentvolumes`
3. `storageclasses`

Reason:

- PVC is the most user-facing and operationally active storage surface

## FSD Cleanup Rules For This Wave

- `pages/*` may coordinate route and workspace state, but should not own section-specific table behavior
- `widgets/*` may compose views, but should not absorb growing domain orchestration
- `features/*` should own:
  - section sync contracts
  - action flows
  - enrichment triggers
  - workbench open requests
- `entities/*` should own:
  - row adapters
  - display-normalized domain data
  - domain labels and formatting rules

## Review Guardrails

For every PR in this wave:

- one family or one bounded slice only
- explicit before/after runtime boundary in the description
- targeted section tests added or updated
- no new catch-all generic list logic
- no hidden coupling through `workload-display.svelte`

## Definition Of Done For The Wave

- `CONFIGURATION`, `NETWORK`, and `STORAGE` no longer rely on one shared family owner for behavior ownership
- `cluster-page.svelte` and `workload-display.svelte` shrink in orchestration responsibility
- default section views remain bounded and snapshot-first
- advanced actions/details/workbench behavior is explicit per section
- `svelte-check` stays green
- targeted rewritten-section suites are green

## Honest Status After This Plan

After this rewrite wave, the app should be closer to:

- stable and scalable for most serious scenarios
- architecturally cleaner
- more honest about section boundaries

But it still will not automatically mean full Lens-class parity.

That remains a later product wave:

- saved views
- pinned filters
- cross-section action consistency
- larger-scale validation on `50-100` clusters
