# Who is ROZOOM for?

ROZOOM is built for teams that manage Kubernetes in production.
It replaces the cycle of switching between kubectl, k9s, Lens, Helm CLI,
Prometheus dashboards, and Slack alerts with one desktop IDE.

---

## Alex - Junior Developer (6 months K8s)

> "I just want to deploy my service and see if it's running."

**Pain:** cryptic error messages, fear of breaking production, uncertainty about namespaces.

**How ROZOOM helps:**

- **Visual status indicators** - cluster cards show health score, traffic-light badges, capacity at a glance. No need to parse `kubectl get pods` output.
- **Linter diagnostics** - plain-language explanations of problems ("3 pods have no resource limits") instead of raw kubectl errors.
- **Helm Catalog** - browse curated charts, see descriptions, one-click install. No need to memorize `helm repo add && helm install` flags.
- **Safe defaults** - destructive actions (delete, evict, drain) require explicit confirmation. Scale and restart are separate from delete in the menu.
- **Copy kubectl command** - every action shows the equivalent kubectl command. Learn K8s by using it, not by memorizing.

**Typical workflow:** Open ROZOOM -> see cluster health -> click into Deployments -> find your service -> check status/logs -> done.

---

## Jordan - DevOps Engineer (8 clusters, 5 years)

> "I'm managing 8 clusters and I need to move fast without losing context."

**Pain:** constant tool-switching, cluster context errors, slow dashboards, no keyboard shortcuts.

**How ROZOOM helps:**

- **Fleet Dashboard** - see all 8 clusters on one screen with health scores, capacity, alerts, security posture. One glance replaces 8 terminal tabs.
- **Command Palette (Cmd+K)** - fuzzy search across clusters, workload pages, and actions. Type "prod deploy" and jump there. Zero mouse clicks.
- **Vim-style navigation** - `g d` goes to Deployments, `g p` to Pods, `/` focuses search. Power users never leave the keyboard.
- **Multi-pane workbench** - split screen with logs + YAML + events. Investigate a pod without switching windows.
- **Quick Actions** - Scale deployment directly from the action menu (no YAML editing), one-click rollout restart, cordon/drain nodes.
- **Bulk operations** - select multiple deployments, restart all at once, download all YAML.
- **Namespace switching** - persistent per-cluster namespace selection. No more `kubectl config set-context --namespace`.

**Typical workflow:** `Cmd+K` -> "prod" -> Enter -> `g d` -> find deployment -> Scale to 5 -> done. Under 10 seconds.

---

## Sam - Senior SRE (8+ years, incident response)

> "It's 3am and something is on fire. I need to understand what broke in 5 minutes."

**Pain:** fragmented tools for logs/metrics/events, lost context during navigation, difficulty reconstructing incident timeline.

**How ROZOOM helps:**

- **Investigate action** - opens logs + YAML side-by-side in dual pane. See what changed and what's failing simultaneously.
- **Live log streaming** - Stern-based log viewer with ANSI color rendering, search, bookmarks, horizontal scroll for wide output.
- **Global Triage** - cross-resource problem scanner across 46+ resource types. Critical issues surface first, scored by severity.
- **Pod events timeline** - see all events for a pod in chronological order. Correlate restarts with OOM kills, scheduling failures, image pulls.
- **Audit trail** - cluster manager tracks when clusters were added, connection status, runtime state changes.
- **Fleet drift detection** - compare configuration across clusters. Find the one cluster that's different from the other 7.

**Typical workflow:** Open Fleet Dashboard -> see which cluster is red -> click in -> Global Triage shows top issues -> Investigate the failing pod -> logs + events in split view -> identify the root cause.

---

## Which persona fits you?

| If you...                             | Start with                                                              |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Just deployed your first service      | [Dashboard](dashboard.md) -> [Overview](overview.md)                    |
| Manage multiple clusters daily        | [Fleet Dashboard](dashboard.md) -> `Cmd+K`                              |
| Get paged at 3am for incidents        | [Global Triage](global-triage.md) -> Investigate action                 |
| Want to understand what ROZOOM checks | [Observability](observability.md) -> [Security](security-compliance.md) |
