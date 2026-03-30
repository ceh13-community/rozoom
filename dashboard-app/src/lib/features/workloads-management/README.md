# Workloads Management DoD

Definition of Done for any new workloads/configuration integration:

1. Resource is declared in `entities/workload/model/resource-schema.ts`.
2. Capabilities are explicit (`hasLogs`, `hasYamlEdit`, `namespaced`, etc.).
3. Default columns and sorting are defined via schema, not hardcoded in widget.
4. Details page uses shared blocks (`DetailsMetadataGrid`, `DetailsEventsList`).
5. Quick debug actions expose `kubectl get -o yaml` + `kubectl describe` (+ logs when applicable).
6. Route/deeplink state is serializable via `workbench-route-state`.
7. Query/filter behavior supports structured syntax (`resource-query`).
8. Saved views persistence works per cluster + workload.
9. Relation links are exposed via `resource-relations` where possible.
10. Error mapping goes through `workload-error`.
11. Telemetry events are emitted for key actions (details open, yaml edit, apply).
12. Unit tests are added for data mapping and command builders.
13. Contract/smoke tests cover details, yaml, tab close confirm, and restore.
14. Accessibility checks: keyboard reachability + ARIA labels for actions.
15. Formatting/lint/tests pass.
