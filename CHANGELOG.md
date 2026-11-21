# Changelog

All notable changes to ROZOOM - K8s Linter IDE.

The first paragraph of each release section becomes the release notes in the
updater feed (latest.json) and on the GitHub release page, so it must state
the user-facing change in plain language. The in-app update notification
deliberately shows fixed copy and never displays these notes.
The release build fails if the section for the released version is missing.

## [0.26.5] - 2026-11-21

Cluster lists now update live. In the desktop app the Kubernetes watch never
worked, so lists fell back to a kubectl watch whose events all went to Pods:
Services, Deployments and other lists jumped, showed Stale while the data was
current, and Pods switched CPU and Memory to Loading every 30 seconds. Pod and
workload changes such as Terminating, Pending or a new Ready count now show up
as they happen. Workload logs open as a live stream, keep the line you are
reading in place, and continue after a short dropped connection without
repeating lines. On Linux (.deb, .rpm) download the new package from the
release page and install it the way you installed this one. We recommend this
update.

### Fixed

- The desktop app sends Kubernetes API requests from the Rust side, so the
  watch is no longer blocked and lists get changes as they happen. The watch
  request no longer sends parameters the API server rejects.
- When the app has to fall back to kubectl watch, each event goes to its own
  list instead of Pods. After every restart of that watch the list is loaded
  again, so changes made in between are not lost.
- A list is marked live only while its stream is running. When the fallback
  watch gives up, for example on a permission error, the list says so instead
  of showing old data as live, and the app tries the API again after a minute,
  then less often.
- Pods come from the pod watch: a deleted or starting pod changes state in the
  table without waiting for the next refresh. The Refreshing banner shows only
  when a refresh fails, so the table no longer moves down and up, and CPU and
  Memory keep their values between samples.
- Logs of Deployments, DaemonSets, StatefulSets, ReplicaSets, Jobs and Cron
  Jobs open as a follow stream instead of polling. The first lines are not
  shown twice, and the line you are reading stays in place while new lines
  arrive.
- After a dropped connection the log stream resumes where it stopped. Lines
  already shown are not repeated, and new lines with the same text are kept. A
  break longer than five minutes starts a fresh stream.
- DaemonSet logs no longer reconnect every 8 seconds, and they show timestamps
  like the other workload logs.
- Workload log text is capped at about one million characters, which keeps
  memory bounded.
- Each API request has its own cancel signal, so long sessions do not pile up
  listeners.

## [0.26.4] - 2026-11-20

Security release. Inspect Element in the right-click menu and Ctrl+Shift+I
opened the web inspector, whose console could run any script with the app's
full access to your clusters. Release builds no longer contain it. A kubeconfig
with a YAML error, pasted or generated in the connect wizard, wrote the lines
around the error to the app log, including token and client-key-data values.
The log line now holds only the position and the error name. If that happened
to you, open Help > Open Logs Folder, delete the old log files and rotate
the credentials from that kubeconfig. A cluster that does not answer now shows
as unreachable on its card and on every page, with Retry, instead of empty
lists and green statuses. On Linux (.deb, .rpm) the app does not update itself:
download the new package from the release page and install it the way you
installed this one. This release also adds Text size (Ctrl/Cmd + = / - / 0),
a Help menu on every OS and network debug from the pod menu, makes Attach a
read-only view of the process output, keeps workbench tabs when you change the
pane layout, and fixes pod port-forwards to ports below 1024. We recommend
this update.

### Security

- Release builds are built without the web inspector, so Inspect Element and
  Ctrl+Shift+I are gone.
- A kubeconfig YAML error is logged as its position and error name only, for
  example "Invalid YAML format at line 8, column 1 (YAMLException)". The same
  text is shown in the add cluster dialog.
- Tauri is updated to 2.12.7 for the IPC origin advisory GHSA-7gmj-67g7-phm9.
- Manage Kubernetes Clusters no longer checks again in the background a cluster
  whose last check got no answer. A sign-in that waits for you, such as a
  kubelogin browser login or device code, is started only by Retry or by
  opening the cluster, not every 30 seconds.
- Network debug runs with the NET_RAW capability only, not NET_ADMIN, so the
  session cannot change the pod's routes or firewall rules. When it is refused,
  the message shows only kubectl's last line, never the output of a credential
  plugin such as a sign-in link or device code.
- Background kubectl proxy processes could pile up and outlive a crash; each
  one gave read access to the cluster to any local process. The app now keeps
  one per cluster.

### Changed

- A cluster that does not answer shows "Cluster unreachable" or "Auth expired"
  on its card with the reason, the last successful contact and Retry. Drift, scores and counters
  are hidden until it answers again, and cluster pages show the same state
  instead of a skeleton or "No pods found". This works with the Linter on or off.
- Deleting from the configuration, RBAC, network and storage lists asks for
  confirmation and lists the objects that will be deleted, like workloads and
  Pods already did.
- The Pods page lists every pod instead of the first 400: the NS filter,
  search, Download CSV and counters cover the whole cluster. Grouped views keep
  a 400-row limit and say so. When Select all reaches pods on other pages, the
  delete and evict dialogs say how many are not on the current page.
- Exec presets no longer show a "bundled" badge, because kubectl runs the
  cloud CLI from your PATH. Cloud import says when the provider's CLI is not
  bundled in this build instead of answering "No clusters found."
- App icons show the wheel only, and the logo wordmark is spelled correctly.
- A render error shows an error panel instead of an empty page, and uncaught
  errors are written to logs.log.
- Text size: Ctrl/Cmd + = and Ctrl/Cmd + - change the size of the whole
  interface from 80% to 150%, Ctrl/Cmd + 0 resets it. The same control is on
  the Manage Kubernetes Clusters page, and the size is kept between launches.
- The Help menu is on every OS: Documentation, Keyboard Shortcuts, Report an
  Issue, Check for Updates, Open Logs Folder and About. Keyboard Shortcuts
  lists every shortcut the app handles.
- The full build bundles jq.
- Network debug (netshoot) in the pod menu: after a confirmation it adds an
  ephemeral container with nicolaka/netshoot v0.16, pinned by its digest, to
  the pod and opens a shell in it with dig, curl, nc, tcpdump and mtr. It
  stops when you close the window or after an hour. Kubernetes keeps the
  container, and NET_RAW with it, in the pod spec until the pod is recreated.
  A namespace whose Pod Security level is baseline or restricted refuses it;
  the message says that network debug needs the privileged level.
- Attach pod shows what the main process of the container prints, read-only.
  It no longer sends your keys to the process, so it cannot stop it by
  accident. To run commands, use Shell.
- Shell, Attach pod and PVC disk usage explain in plain words what they do and
  why a value is missing.
- After Logs, Previous logs, Edit YAML, Events or Investigate on a pod, the
  panel with the result comes into view and takes focus. Esc closes it and
  focus goes back to the row menu. It does not take focus while you are
  typing in another field.
- Panels that wait for the cluster show one loading indicator that says what
  is loading, and Workload Map no longer says "No data yet" before its first
  scan.
- Workbench tabs (Logs, YAML, Events and others under a list): closing a tab
  asks first only when it would lose unsaved YAML edits or stop a running
  port-forward. Other tabs close at once with an Undo. Choosing fewer panes
  keeps every tab open. The layout switch reads "Panes 1 2 3", each tab shows
  the number of the pane it is in, and panes are named Pane 1, 2 and 3.
- Pinned page chips say "2 panes" instead of "2P", group the pane buttons
  under "Open in", and Unpin shows an Undo instead of a dialog.
- Colors meet WCAG AA contrast in the light, dark and K9s themes, including
  buttons, field borders and the text on the light theme's blue sidebar rail.

### Fixed

- Linux: the window grew on every launch until it was larger than the screen.
  It now opens at 1024x768 or maximized, and a size set by hand is not kept on
  Linux for now.
- The details panel closes with Escape.
- Popovers (Runtime, Inspector, NS and Columns checklists, filters) stay inside
  the window and scroll.
- The Pods list reloads when the namespace selection changes, instead of
  showing the pods of the old selection.
- Sync sec accepts typed values such as 30 or 45.
- Quick actions buttons stay inside the Detected kubeconfig files card on
  narrow windows.
- The installer no longer contains internal project notes.
- Table column headers are no longer cut to a few letters ("Na...", "St...") on
  narrow windows, and every column in view shows its header. On the
  Deployments page names stay on one line and the table scrolls sideways.
  In ConfigMaps, Secrets and the custom resource definitions list the headers
  no longer run into each other or shrink to a letter: these tables also
  scroll sideways when the window is too narrow for every column.
- The page title stays readable in a narrow window; the header buttons move
  to a second line instead.
- The usage strip and the Traffic Chain in the details panel were dark grey
  and hard to read in the light theme. They now follow the theme.
- On the cluster card in Detailed view, the status and credentials badges wrap
  inside the card instead of running past its edge.
- Manage Kubernetes Clusters showed "Online" and counted a cluster as online
  when the cluster card already said unreachable. It now shows "Unreachable"
  or "Auth expired", the last contact time, and counts the cluster as offline.
- Opening Cron Jobs, most often right after Jobs, could replace the page with
  an error panel. The list now opens every time.
- After a touchpad scroll on a long page, the next page (Global Triage, Service
  Chains and other short pages) could open scrolled past its end and look
  empty, and the collapsed cluster menu showed blank space below its icons.
  Every page now opens at the top, and the menu stays within its items.
- Pod port-forward to a port below 1024 failed without root. It now uses
  local port 30000 plus the port (80 becomes 30080), opens on 127.0.0.1, and
  a second pod on the same port gets the next free local port.
- Overview workload tiles said OK when the warning events could not be read.
  They now show Unknown with the reason, and the Cron Jobs tile shows Unknown
  until its check has a result.
- The close button on a workbench tab closed a YAML tab with unsaved edits
  without asking.
- Manage Kubernetes Clusters showed a stopped cluster as Online until you left
  the page, and Online only kept listing it. The page now checks again every
  30 seconds while it is open, and the status filter follows the same live
  status as each row.
- After switching the page between one and two panes, the second pane could
  show "Error: No data provided" instead of loading. The main pane had the
  same problem after Pods and back.
- Closing an Attach window while it was still starting left kubectl running.
- Release notes on the release page and in the update feed no longer break
  sentences in the middle.

Something confusing or broken? [Tell us what's wrong](https://github.com/ceh13-community/rozoom/discussions).

## [0.26.3] - 2026-11-11

Security release. When you connected a remote cluster through the Bearer Token,
X.509 Certificate, Exec Plugin or Manual OIDC form and left the CA field empty,
TLS verification was silently turned off, so your credentials went to a server
whose identity was never checked. Now a remote cluster without a CA is refused
and the form says why. Add the cluster's CA certificate, or tick Skip TLS
verification (insecure) if you accept the risk for this connection. Clusters
added earlier keep the settings they were saved with: if you left the CA empty,
remove the cluster and add it again with its CA. On Linux (.deb, .rpm) the app
does not update itself: download the new package from the release page and
install it the way you installed this one. We recommend this update.

### Changed

- A remote cluster added through the Bearer Token, X.509 Certificate, Exec
  Plugin or Manual OIDC form needs its CA certificate. Skip TLS verification
  (insecure) is a checkbox with a warning on each of these forms. It applies to
  one connection and cannot be ticked while the CA field has text. Plain HTTP
  to a remote host stays refused.
- A local cluster (localhost, 127.x, ::1) still connects without a CA, but
  verification now stays on. A local cluster with a self-signed certificate and
  no CA fails verification and shows auth-error: add the CA or tick the
  checkbox.

### Fixed

- The CA field accepts a PEM certificate as well as base64, also when it is
  pasted as several lines.
- Values pasted into these forms are checked before anything is written. A
  space, line break or control character in the server URL, token, client
  certificate or key is refused with the name of the field, and so is a CA with
  characters a PEM file cannot have. One such character could add settings to
  the generated kubeconfig.
- Cluster names with quotes, colons or # are written correctly to the generated
  kubeconfig.
- The skip-verification and static-token warnings are readable on the light
  theme.

Something confusing or broken? [Tell us what's wrong](https://github.com/ceh13-community/rozoom/discussions).

## [0.26.2] - 2026-11-09

Security release. Read-only clusters: kubectl, oc, helm, velero and the
terminal are now checked before they start. This is a guard in the app, not an
access boundary: for a hard limit use RBAC. The credential files the app writes
are readable only by you, and resource names go to kubectl as one argument.
Performance and Capacity Intelligence open with data again, and the first
screen probes a cluster only when you click Check. On Linux (.deb, .rpm) the
app does not update itself: download the new package from the release page and
install it the way you installed this one. We recommend this update.

### Added

- Fleet Settings shows the Install ID and the hash PostHog stores, each with a
  Copy button. A deletion request quotes the hash.
- Check and Check all on the first screen. A detected cluster starts as Not
  checked and is probed only when you ask.

### Changed

- Read-only clusters: kubectl, oc, helm, velero and the terminal are checked
  before they start, in the debug terminal, the command console, the GitOps
  and backup panels and every helm wrapper. This is a guard in the app, not an
  access boundary: for a hard limit use RBAC. helm install on a read-only
  cluster is blocked, not confirmed. The Trivy Quick scan runs without the
  node collector on a read-only cluster and creates no objects there.
- Ready on the first screen appears only when the API server answered.
  Connection refused, timeout and DNS failures show as unreachable with the
  reason in the row tooltip.
- Credential files (per-cluster kubeconfig copies, the pasted kubeconfig,
  connect-test files, helm values and YAML backups) are created owner-only,
  and existing ones are fixed on launch. The pasted kubeconfig is removed
  after the import.

### Fixed

- Scale accepts a replica count you edited. Before, only an unchanged value
  went through and the dialog showed no error.
- Performance and Capacity Intelligence: kubectl --raw requests no longer get
  -o json appended and raw paths are passed unquoted, so both panels show data.
- CSR approve, node delete and CRD delete pass the resource name after `--`.
  A name that starts with a dash or contains whitespace is refused.

Something confusing or broken? [Tell us what's wrong](https://github.com/ceh13-community/rozoom/discussions).

## [0.26.1] - 2026-11-05

Fixes how Debug describe and Delete in the configuration lists run kubectl for
resources with unusual names, and the app no longer connects to font servers when
it starts. We recommend this update.

### Changed

- Debug describe runs kubectl with an argument list. The command it shows now
  reads `kubectl describe pod -n prod -- api-0`.
- The Copy kubectl describe and Copy kubectl get actions quote a name that a shell
  would not read back as one word. On Windows, where that quoting does not apply,
  they say so for such a name and offer Run debug describe instead.

### Fixed

- Delete in the configuration lists (ConfigMaps, Secrets, Roles and others) passes
  the name after `--`, so kubectl reads it only as a name.
- The terminal refuses a typed command it cannot parse and shows the parse error.
- Removed the external font links, which opened connections to Google's font
  servers on every start. The fonts themselves were never loaded by the app.

## [0.26.0] - 2026-11-04

Usage telemetry now goes to PostHog in the EU (Frankfurt) and sends less:
usage counts tied to a random install ID, no person profiles, no screen
addresses and no device identifiers. The consent prompt names the processor
and region and links the privacy policy. Every bundle now ships
THIRD-PARTY-LICENSES.md, and the sidebar links to the user documentation at
rozoom.app/docs.

### Added

- THIRD-PARTY-LICENSES.md in every bundle, generated at release time from the
  real npm and Cargo dependency trees and the bundled CLI tools.
- Sidebar link to the user documentation at rozoom.app/docs.
- Port-forward action in the pod actions menu of the flat (default) pods view.
- Workload Map plugin is on by default (preferences migration v3).

### Changed

- Telemetry endpoint moved to PostHog EU Cloud; the consent prompt and the
  Fleet Settings toggle name PostHog (EU, Frankfurt) and link the privacy
  policy.
- Telemetry payload minimised: the cluster hash is salted, no person profiles
  are created, geolocation lookup is off, and the screen address, referrer and
  device or session identifiers never leave the app.
- Read-only clusters are enforced where kubectl and helm actually run, not only
  in the UI.
- Sentry scrubs credentials by default in all modes.
- Linux releases ship .deb and .rpm; the AppImage is no longer published.

## [0.25.3] - 2026-10-12

The manifest linter is now on by default for every cluster you connect: new
clusters are checked right after connecting, with no setup. You can turn it
off per cluster from the cluster card, or for all clusters from the sidebar
toggle.

### Added

- Telemetry consent prompt after the first scan completes; usage reporting
  stays off until you explicitly agree.

### Changed

- The cluster card now tells you how to turn the linter on when it is off.

## [0.24.0] - 2026-09-16

### Added

- Usage telemetry toggle in Fleet Settings: consent can now be granted or
  revoked at any time from the app, not only via the first-launch prompt.
- Preflight RBAC gating for batch workload actions (delete / edit / scale):
  permissions are checked via `SelfSubjectAccessReview` before the action
  runs, so forbidden operations are surfaced up front instead of failing
  midway through a batch.
- Updater observability: update check, download, and apply outcomes are
  written to the tauri log file, so failed silent updates can be diagnosed
  from the log instead of guesswork.

### Fixed

- Release builds now receive `PUBLIC_POSTHOG_KEY` / `PUBLIC_POSTHOG_HOST` at
  build time (both the tauri-action build and the standalone AppImage build).
  Every release since telemetry shipped had the key missing from the bundle,
  so opt-in telemetry was permanently dark even after user consent; this is
  the first release where consented telemetry actually reports.

## [0.22.3] - 2026-07-02

### Added

- Local cluster auto-discovery: the connect wizard can now scan
  `~/.kube/config` and offer detected contexts to connect in one click,
  instead of requiring a manual kubeconfig paste. Discovery is gated behind
  an explicit opt-in consent step — nothing reads the file until the user
  agrees — and prioritises local-runtime contexts (minikube, kind, k3d,
  Docker Desktop) for a low-friction first connection.
- TLS safety gate for cluster connections: connections over plain HTTP or
  with an untrusted certificate are surfaced before any request is sent.
- CA certificate normalization: kubeconfig CA data is accepted as either PEM
  or base64.
- Readable credential expiry: client-certificate `notAfter` and JWT `exp` are
  parsed and shown as a human-readable expiry state.

## [0.22.2] - 2026-06-11

### Added

- Anonymous usage telemetry (PostHog) with strict opt-in consent: an explicit
  prompt on first launch, and no events leave the app until consent is given.
  Declining persists and is never re-asked; DNT/GPC browser signals disable
  telemetry regardless of stored consent. Tracked core actions: dashboard
  viewed, workload detail opened, resource action executed.

### Fixed

- Windows: helm install no longer hangs during sidecar provisioning (zip is
  extracted via `bsdtar`).
- Sidecar provisioning no longer half-runs silently when a single tool
  download stalls or fails; failures now surface per tool.

### CI

- E2E smoke jobs skip (instead of failing) on Playwright CDN download outages.
- Manual release builds are protected from concurrency auto-cancellation.

## [0.22.1] - 2026-06-05

Trust-fix release: removed dead sponsor handles from funding metadata and
restored Apache-2.0 license detection on GitHub. No runtime changes.

## [0.22.0] - 2026-05-11

Promotes `0.22.0-rc.3` to a final release. No runtime changes since `rc.3`;
only the new `design-system/` brand kit was added to the repository for
consumers of the brand assets (logo, colors, components, screenshots).

### Added

- `design-system/` — brand kit (logo, banner, font subsets, color tokens,
  preview pages for components, anatomy, spacing) for downstream usage.

### Notes

- Runtime build is identical to `0.22.0-rc.3`. See `[0.22.0-rc.3]` below for
  the cumulative feature/fix list shipped in this release.

## [0.22.0-rc.3] - 2026-05-09

### Added

- Cluster Ops UX overhaul rounds 1–10 across all 5 Cluster Ops pages
  (Helm Catalog, Helm Releases, Backup Status, Version Audit, Deprecation Scan)
- Fleet Health Overview at the top of Manage Clusters
- Cluster Manager keyboard shortcuts and bulk operations (refresh, set namespace, add tag)
- Cluster Manager Danger Zone — type cluster name to confirm removal
- Connect wizard: kubeconfig preview, live Test Connection, exec-plugin connect method,
  credential risk chip, auto-detect for AWS/GCP/Azure profiles, paste kubeconfig recency
- Cluster card last-refresh state, profile-disabled hints, friendly display name
  (e.g. EKS short name instead of full ARN), Load button tooltips and inline spinner
- Dashboard rotation debugger popover on toolbar
- Cluster card credential risk chip with Shield indicator for high/critical findings
- Helm Catalog: per-chart value overrides, 10-minute install timeouts, F5 NGINX,
  Traefik presets, command console for install/uninstall transcripts
- Helm Releases: clickable revision numbers in history, inspector onboarding hint,
  command console integration for install/upgrade/uninstall/rollback/test
- GitOps Bootstrap: shared command console transcript mirror
- Capacity Intelligence wired to metrics-server with per-workload waste breakdown
- Performance Observability: apiserver RED + CFS throttling via Prometheus service proxy
- Security Audit: RBAC + PSS scanners with transparent findings
- Trivy Hub: local quick scan alongside operator findings, paginated findings table,
  service-proxy fast path, kubectl loop guard for empty tabs
- Plugin Marketplace top-level section with menu visibility wired to plugin toggles
- Sentry Phase 8.2 credential scrubbing with HMR/Vite client URL filtering
- Compliance Hub tabs, preflight, framework selector, remediation
- Backup Audit inline command console for velero install
- Alerts Hub inline command console for prometheus stack install
- Notifications: read/unread state in Bell panel
- Cluster auth cache, credential risk cache, fleet summary, infer-env helpers
- Tokenize-command shared utility for shell-window args parsing
- Cert health graceful fallback when control plane is managed
- Phase 9 roadmap: performance and parallelism via Rust workers (docs)

### Changed

- Menu reorganized: Cluster Ops, Security & Compliance, Observability,
  Plugin Marketplace as top-level section; icon collisions resolved
- Workload labels: Helm → Helm Releases, Cluster Version & Helm Audit → Version Audit,
  Cluster Backup Status → Backup Status, Capacity Intelligence → Cost & Efficiency,
  Plugins → Plugin Marketplace, resourcemap → Resource Map
- Cluster card moves Credentials expired into Primary Alert slot
- Drift badge prefixes label with "Drift" to disambiguate from status badge
- Cluster Manager Scan/Refresh CTA scoped to Cloud Providers only
- /dev/ui-catalog gated to dev and staging only

### Fixed

- Cluster card refresh timestamp on errored health checks and local attempt timestamps
- Cluster card toolbar wrapping on narrow widths
- Cluster card refresh-interval dropdown sync between compact and detailed views
- Cluster score: do not penalize absence of optional observability addons
- Helm catalog: detect installs in custom namespaces, expand port-forward coverage,
  bump JS-level timeout ceiling so helm --timeout 10m wins
- Cluster page Updating dots visibility (text-foreground in loading state)
- Helm panel table-fixed layout to prevent row rendering gaps + reload on nav-back
- RPM build: suppress build-id errors for bundled binaries, glob /usr/bin/rozoom-\*
- Cargo: declare url and webkit2gtk as explicit dependencies
- Trivy checksum fetch via direct CDN URL with checksum-skip fallback
- TCPing pinned version, darwin-arm64 fallback, GitHub API rate-limit retry

### Notes

- This is the first CHANGELOG entry since 0.20.0; the 0.21.0-rc.x and 0.22.0-rc.1 / rc.2
  cycles are summarized cumulatively above. The 0.21.0-rc.x sections below were kept
  in a separate file until 0.26.3. See Git history for per-PR detail.

## [0.21.0-rc.2] - 2026-04-18

Second release candidate for 0.21. Rolls up the 14 UX workstreams from rc.1 plus a round of post-review fixes on security, reliability, and performance.

### Added

- **GitOps Bootstrap panel** - editor-driven ArgoCD / Flux installation with Helm repo add, install progress, `Application` / `Kustomization` YAML generation, and detection of already-installed controllers
- **Local YAML Backup** - full-cluster or per-namespace export of 14 namespaced + 2 cluster-wide resource kinds to `~/Downloads/rozoom/backup/`, with metadata manifest, list, restore, and delete
- **Helm Catalog advanced** - version autocomplete from repo index, CodeMirror values editor with dark theme, port-forward from the UI with cleanup on panel unmount
- **Helm Catalog presets** - grouped one-click install bundles (observability, policy, security, backup) with batch-level progress
- **Helm page UX overhaul** - search, dry-run preview, per-row rollback, unified humanizer for 8 common Helm error branches
- **Nodes Pressures** - tabbed severity view, taints, flapping detection from 24h history, per-node quick actions
- **Auth & Credentials** - real detection of kubeconfig auth types (token, cert, exec, OIDC), live token-expiry countdown, refresh flow
- **Rotate Certificates** - severity grading, humanized errors, guided wizard, persistent audit trail ConfigMap, cert-manager integration
- **Backup Status** - freshness badges, humanized Velero errors (AWS / Azure / GCP / generic), restore confirm, telemetry
- **Version Audit** - upgrade flow, severity grading, freshness
- **Certificate expiry notifications** - Bell icon panel driven by a background watcher
- **Cluster auth-expired state** - card-level surfacing of 401 / 403 / `exit status 255` via word-boundary regex
- **Resource pressure fallback** - requests-vs-allocatable estimates for clusters without metrics-server, with session-level skip when metrics-server is known available
- **Control plane checks** - `ok` instead of `unknown` for RKE / kubeadm / OpenShift clusters; tightened `/readyz` 404 detection so verbose output no longer triggers bogus `/healthz` fallbacks

### Fixed

- GitOps: `syncArgoCDApp` patches `.operation.sync` on the main Application (dropped `--subresource status`); previously the patch went to `.status.operation` and the ArgoCD controller silently ignored it
- GitOps: Helm install steps now run under an `AbortController`; waitForDeploymentReady polling stops on panel unmount instead of leaking kubectl calls
- GitOps: confirm dialog before `argocd-install` / `flux-install` so a stray click no longer deploys a cluster-wide controller
- YAML Backup: Secrets are excluded by default; export requires an explicit opt-in checkbox plus a plaintext-warning confirm. Prevents accidental credential leaks into synced `~/Downloads`
- YAML Backup: restore writes each manifest to a UUID-suffixed temp path (fixed `yaml-restore-temp.yaml` raced between parallel restores and on failed cleanup)
- YAML Backup: restore dry-run switched from `--dry-run=client` to `--dry-run=server` so admission / quota / immutability are actually validated before apply
- Helm: `--dry-run` bumped to `--dry-run=client` for Helm 3.13+ compatibility; `--wait` / `--rollback` / `--timeout` skipped on dry-run; added `--version` support
- Helm: repo add / repo update errors are now collected and surfaced alongside install failures instead of being silently swallowed; users see the real cause (e.g. network) instead of only "chart not found"
- Helm Catalog: `actionInFlight` is held at batch level during preset loops so concurrent row clicks are properly queued
- Helm Catalog: port-forwards started from the UI are cleaned up on panel unmount via `onDestroy`
- Helm values tempfiles: `sweepHelmValuesTempfiles()` runs at app startup to remove stale `helm-values-*.yaml` left by crashed installs
- Auth & Credentials: replaced hand-rolled YAML scanner with `js-yaml` parse + typed extraction; 1Hz countdown tick paused when tab is hidden
- Rotate Certificates: audit ConfigMap write failures now surface a toast with humanized hint and explicit "Action succeeded; only the audit ConfigMap is missing" note (previously silent `.catch {}`)
- Backup Audit: extracted `humanizeVeleroError` to `$features/backup-audit/model/humanize` with 11 error branches covering AWS / Azure / GCP / generic Velero failures
- 401 / 403 detection: switched auth-error matcher from substring to word-boundary regex so log line numbers like `401ms` or `exit status 2550` no longer trigger false-positive `auth-expired` badges
- metrics-server fallback: `kubectl get pods --all-namespaces` is skipped for clusters where a recent probe saw `kubectl top` working; re-probes after 10 minutes or when metrics-server fails

### Changed

- Extracted per-page humanizers to dedicated modules under `$features/*/model/humanize.ts`, each with unit tests (Helm: 10 tests, Velero: 14, Cert: 10, Cert severity: 8)
- Nodes Pressures: 29 unit tests across humanize / classify / history model modules

### Security

- Secrets are no longer part of the default YAML backup set
- Restore dry-run uses server-side validation against the live cluster

## [0.21.0-rc.1] - 2026-04-03

First release candidate for 0.21 - rolls up 14 UX workstreams merged into `feat/all-ux-combined`. See `chore: bump version to 0.21.0-rc.1` commit for the composition.

## [0.20.0] - 2026-03-30

### Added

- Pre-commit hooks via husky + lint-staged (format + lint on every commit)
- Dev-only UI component catalog at /dev/ui-catalog
- Network recovery listener - auto-recovers clusters after VPN reconnect
- Fleet heartbeat - lightweight /healthz probe every 60s for all clusters
- All resource categories in workspace pane dropdown (Configuration, Access Control, Network, Storage, Custom Resources)
- Grouped optgroup layout in pane workload selector
- Rancher to platform compatibility docs

### Fixed

- Multi-pane layout (2/3) collapsing to 1 when navigating between workloads
- Workspace pane state lost on cluster switch in unpinned mode
- Offline clusters appearing in pane cluster selector
- 47 pre-existing svelte-check type errors (interleaved handlers, duplicate accessors, deprecated components)
- 14 pre-existing eslint errors
- 12 pre-existing prettier formatting issues
- onCopyKubectlDescribe missing from ResourceActionsMenu props

### Changed

- Feature capability cache clears only unreachable entries on network restore (not all)
- Workspace layout and pane config persisted to localStorage for unpinned tabs

## [0.19.0] - 2026-03-29

### Added

- Three-state secret visibility in details sheets (masked -> base64 -> decoded)
- Resource metrics badge with CPU/Memory progress bars for pods and nodes
- Node disk usage indicator from kubelet stats summary API
- PVC disk usage bar in details sheet from kubelet stats
- Traffic chain visualization for all 20 resource types
- Resource Map page in Cluster Ops (full cluster dependency map)
- Problem-first default sorting for RBAC, Namespaces, Custom Resources
- Risk findings with severity levels (critical/high/medium) and colored indicators
- Animated LoadingDots across all loading states
- Shell command history persistence (up to 200 commands)
- Sidebar and workloads menu state persistence
- Loading states for Pod Restarts and Node Pressures pages
- App version display in sidebar footer

### Changed

- Explain this state section made collapsible (auto-opens on sync error)
- Metrics badge moved from header to body in details sheets
- Dropdown menus use dynamic max-height for viewport fitting

### Fixed

- Pod watcher timeout too short for remote clusters in Tauri dev mode
- Pod Attach using kubectl exec instead of kubectl attach
- Kubelet health check key mismatch (kubelet -> kubelet_cadvisor)
- Node-exporter detection limited to monitoring namespace
- Kubescape CRD existence check before triggering scan
- Hetzner backup region placeholder and checksumAlgorithm for S3-compat
- Details sheet fixed positioning via DOM portal
- Sidebar z-index too low (page content overlapped)
- Sidebar icon alignment in collapsed mode

### Refactored

- Unified details sheets with DetailsSheetPortal (10 sheets)
- Unified action menus with ResourceActionsMenu (4 duplicates removed)
- Unified workbench panels with ResourceYamlWorkbenchPanel
- Deleted 7 dead-code files (-695 lines net)

### Documentation

- Comprehensive docs update for all new features
- Updated CONTRIBUTING.md with architecture overview and component reference

## [0.18.0] - 2026-03-29

### Added

- YAML editor: lint gutter, hover tooltips, breadcrumb, multi-doc nav, path copy, diff view
- Managed provider detection for 11 cloud providers
- Hetzner Object Storage backup support with checksumAlgorithm fix

### Fixed

- OVH providerID prefix (ovh:// -> openstack://)
- Dropdown menus overflowing viewport on small screens

## [0.17.0] - 2026-03-27

### Added

- Hetzner Object Storage as backup provider
- Kubeconform schema validation in YAML editor
- K8s-aware autocompletion with snippets

### Fixed

- Cloud import, cross-platform shell, race condition in CLI execution
- Risk findings readability on dark and k9s themes

## [0.14.0] - 2026-03-15

### Added

- **CodeMirror YAML Editor** - Full-featured YAML editing with ROZOOM dark theme, K8s autocomplete (apiVersion, kind, metadata, spec, containers, probes, volumes, tolerations), YAML linting, code folding, undo/redo, Cmd+F search, Cmd+S save
- **Virtualized Logs Viewer** - Virtual scrolling for 100k+ log lines, line numbers, highlight-in-place search with prev/next navigation and match counter
- **Live Resource Metrics Badges** - CPU/MEM usage bars in pod workbench and node detail headers, polls every 30s, gracefully hides when Metrics API unavailable
- **Cluster Error UX** - Grey "Offline" badge for unreachable clusters, friendly error messages (Cluster unreachable, TLS error, Auth failed, Connection timed out, Cluster not found)
- **CLI Notifications** - Toast notifications for all mutating kubectl/helm commands showing the full command, completion time, and Copy button
- **Helm Catalog** - 23 curated Helm charts for observability, security, and compliance with one-click install

### Fixed

- Metrics endpoint status parsing: correctly distinguishes "not_found" from "unreachable" on cluster cards
- YAML editor async value loading (empty pane on mount)
- Cluster card color consistency when connection errors vs partial check failures

### Security

- Disabled DevTools in production builds
- Added Content Security Policy (CSP)
- Synced version across tauri.conf.json and Cargo.toml
- Removed 20 debug console.log statements from production code

### Documentation

- Added SECURITY.md - security architecture, data access, capability system
- Added PHILOSOPHY.md - project principles, architecture decisions
- Added CHANGELOG.md
- Added .editorconfig

## [0.13.0] - 2026-01-28

### Added

- Helm Catalog page in Cluster Ops with curated charts
- CLI notifications for helm install/upgrade/uninstall
- Manual refresh on dashboard card triggers full diagnostics rescan

### Fixed

- Duplicate Investigate action in Configuration list
- Cache fallback for sync indicator on all workload pages
- Sidebar width and header layout restored

## [0.12.0] - 2025-11-10

### Added

- Fleet Control Plane dashboard with multi-cluster overview
- Cluster health scoring system (0-100)
- Adaptive polling with error streak backoff
- Pod workbench with multi-pane layout (logs + YAML + events)
