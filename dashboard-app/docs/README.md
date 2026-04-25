# Documentation Index

## Getting Started

| Document                                     | Description                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| [who-is-rozoom-for.md](who-is-rozoom-for.md) | User personas - who benefits from ROZOOM and how                         |
| [everyday-tasks.md](everyday-tasks.md)       | Step-by-step guides for common tasks (scale, restart, logs, investigate) |

## Feature Documentation

| Document                                           | Description                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [cluster-manager.md](cluster-manager.md)           | Cluster Manager - start page, tool detection, kubeconfig discovery                                  |
| [dashboard.md](dashboard.md)                       | Fleet Dashboard - cluster cards, auto-refresh, data profiles                                        |
| [overview.md](overview.md)                         | Cluster Overview - control plane checks, health/cluster score, diagnostics scope                    |
| [global-triage.md](global-triage.md)               | Global Triage - cross-resource problem scanner, scoring, grouping                                   |
| [workloads.md](workloads.md)                       | Workloads - 9 resource list pages, action menus, investigate, shared components                     |
| [configuration.md](configuration.md)               | Configuration - Namespaces, ConfigMaps, Secrets, HPAs, PDBs, Webhooks, RBAC, and 20+ resource types |
| [access-control.md](access-control.md)             | Access Control - RBAC resources, risk scoring, access reviews                                       |
| [custom-resources.md](custom-resources.md)         | Custom Resources - CRD management, instance browser, scoring                                        |
| [network.md](network.md)                           | Network - Services, Ingress, Gateway API, NetworkPolicies, Port Forwarding                          |
| [storage.md](storage.md)                           | Storage - PVCs, PVs, StorageClasses, Snapshots, CSI                                                 |
| [cluster-ops.md](cluster-ops.md)                   | Cluster Ops - Helm, Deprecation Scan, Version Audit, Backup, Certificate Rotation                   |
| [compatibility.md](compatibility.md)               | Platform Compatibility - 18 cluster types, bundled CLIs, feature matrix                             |
| [security-compliance.md](security-compliance.md)   | Security & Compliance - KubeArmor, Compliance Hub, Trivy                                            |
| [enterprise-readiness.md](enterprise-readiness.md) | Enterprise readiness, compliance posture, Phase 8 security hardening                                |
| [observability.md](observability.md)               | Observability - Alerts, Metrics Sources, Pod Restarts, CronJobs, Node Pressures                     |
| [killer-features.md](killer-features.md)           | Killer Features - analysis modules and UI panels                                                    |
| [plugins.md](plugins.md)                           | Plugins - architecture, marketplace, creating plugins, feature flags                                |
| [runtime-operations.md](runtime-operations.md)     | Runtime - data profiles, recovery window, watchers, pollers, sorting, pagination, concurrency       |

## Developer Guides

| Document                                                       | Description                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| [THEMING.md](../src/lib/shared/theme/THEMING.md)               | Theming guide - adding themes, CSS tokens, overrides         |
| [jordan-first-ux-initiative.md](jordan-first-ux-initiative.md) | UX initiative - keyboard nav, command palette, quick actions |

## QA & Audits

| Document                                                                   | Description                                        |
| -------------------------------------------------------------------------- | -------------------------------------------------- |
| [qa/cluster-card-indicators-audit.md](qa/cluster-card-indicators-audit.md) | Audit of cluster card status indicators and badges |
| [qa/local-debug-enablement.md](qa/local-debug-enablement.md)               | Local debugging setup and runtime trace flags      |

## Implementation Roadmap

| Document                       | Description                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [ROADMAP.md](../../ROADMAP.md) | Full implementation roadmap with 7 phases, 24 new modules, 192 tests. Includes pre-existing feature inventory and Story Map cross-reference. |

## Operational Docs (served in-app)

Release checklists, QA matrices, staging runbooks, and operator troubleshooting
guides live in `static/docs/` and are served to the frontend at runtime.
See `static/docs/` for the full list.
