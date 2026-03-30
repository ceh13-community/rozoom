# Network - Service Discovery, Ingress & Policies

Manages Kubernetes networking resources: service discovery, traffic
routing (Ingress and Gateway API), network security policies, and
interactive port-forwarding.

---

## Pages

### Core Networking (via `configuration-list.svelte`)

| Resource           | Key Columns                                                                | Scoring            |
| ------------------ | -------------------------------------------------------------------------- | ------------------ |
| **Services**       | Name, Namespace, Type, ClusterIP, ExternalIP, Ports, Selector, Status, Age | No ports: +140     |
| **Endpoints**      | Name, Namespace, Endpoints count, Age                                      | No endpoints: +180 |
| **EndpointSlices** | Name, Namespace, Endpoints, Ports, Status, Age                             | No endpoints: +180 |

### Ingress (via `configuration-list.svelte`)

| Resource            | Key Columns                                           | Scoring                                 |
| ------------------- | ----------------------------------------------------- | --------------------------------------- |
| **Ingresses**       | Name, Namespace, LoadBalancers, Rules, Age            | No rules: +160; no LB: +20              |
| **Ingress Classes** | Name, Controller, ApiGroup, Scope, Kind, Default, Age | No controller: +180; dup defaults: +180 |

### Gateway API (via `configuration-list.svelte`, optional)

| Resource             | Key Columns                               | Scoring                                                |
| -------------------- | ----------------------------------------- | ------------------------------------------------------ |
| **Gateway Classes**  | Name, Controller, Type, Age               | No controller: +180; not accepted: +220                |
| **Gateways**         | Name, Namespace, Listeners, Status, Age   | No listeners: +160; not accepted/programmed: +220/+180 |
| **HTTP Routes**      | Name, Namespace, Parent refs, Status, Age | No parents: +160; not accepted/resolved: +220/+180     |
| **Reference Grants** | Name, Namespace, From/To, Age             | No from: +120; no to: +120                             |

Gateway API resources are auto-discovered via `kubectl api-resources`
and hidden if the cluster doesn't have the Gateway API CRDs installed.

### Network Policies (via `configuration-list.svelte`)

| Resource             | Key Columns                       | Scoring              |
| -------------------- | --------------------------------- | -------------------- |
| **Network Policies** | Name, Namespace, PolicyTypes, Age | No policyTypes: +120 |

### Port Forwarding (dedicated panel)

Interactive port-forward manager:

- Start/stop port-forwards for Services
- Preview forwarded service in embedded web view
- Pop-out to external browser
- Live status tracking per forward
- Copy port-forward command

---

## Action Menu

Unified sectioned menu for all network resources:

| Section         | Actions                                                             |
| --------------- | ------------------------------------------------------------------- |
| **(top)**       | Show details                                                        |
| **Manifest**    | Copy kubectl get -o yaml, Copy kubectl describe, Run debug describe |
| **Diagnostics** | Investigate, Open web tool (Services only)                          |
| **Dangerous**   | Delete                                                              |

Consistent across: row ⋮ menu, details sheet, bulk selection bar.

---

## Details Sheet

Shows per-resource fields:

- **Services**: Namespace, Kind, ExternalIP, ClusterIP, Selector, Status, Ports
- **Endpoints/EndpointSlices**: Namespace, Endpoints count, Ports, Status
- **Ingresses**: Namespace, LoadBalancers, Rules
- **Network Policies**: Namespace, PolicyTypes
- Labels, Annotations

---

## For Developers

### Architecture

```
$widgets/datalists/ui/network/
  network-list.svelte                   - Dedicated table (Services, Endpoints, etc.)
  network-actions-menu.svelte           - Row action dropdown (sectioned)
  network-bulk-actions.svelte           - Bulk selection toolbar
  network-details-sheet.svelte          - Side panel details
  network-workbench-panel.svelte        - YAML workbench
  port-forwarding-panel.svelte          - Port-forward manager (601 lines)
  port-forwarding-panel.test.ts         - 537 lines of tests
  model/
    network-row-adapter.ts              - Row type + data mapping
    network-list-row.ts                 - Row type definition
    service-port-forward.ts             - Port-forward start/stop logic

Most network resources also route through configuration-list.svelte
with dedicated renderers in:
  configuration-list/model/resource-renderers.ts
```

### K8s API Reference

- Services: `v1` core API - `kubectl get svc`
- Endpoints: `v1` core API - `kubectl get endpoints`
- EndpointSlices: `discovery.k8s.io/v1` - `kubectl get endpointslices`
- Ingresses: `networking.k8s.io/v1` - `kubectl get ingress`
- IngressClasses: `networking.k8s.io/v1` - `kubectl get ingressclass`
- NetworkPolicies: `networking.k8s.io/v1` - `kubectl get networkpolicy`
- Gateway API: `gateway.networking.k8s.io/v1` - optional CRDs
