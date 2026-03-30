# Debug Describe Plan

Date: 2024-11-02

## Goal

Add two explicit runtime actions without overloading existing copy actions:

- `Copy describe command`
- `Run debug describe`
- `Open pod debug session`

The goal is to get real `describe` output and real pod-debug capability while keeping the base table cheap and the runtime model honest.

## Decision

Do not turn `Copy kubectl describe` into an execution action.

Keep copy actions cheap and side-effect free.

Add separate runtime-backed actions for:

- running real `kubectl describe` from a reusable debug pod
- opening a real pod-debug flow based on `kubectl debug`

## Why This Is The Optimal Variant

### `describe` does not need a target-pod debug container

`kubectl describe` is an API query. It does not need process namespace access inside the target pod.

That means the cheapest correct execution backend is:

- reuse the existing cluster-scoped debug pod runtime
- run `kubectl describe ...` inside that pod
- stream the output into a workbench or sheet

This reuses the existing shell/debug-pod lifecycle already implemented in:

- [pod-shell.ts](src/lib/widgets/datalists/ui/pods-list/pod-shell.ts)
- [shell-window.svelte](src/lib/widgets/shell/ui/shell-window.svelte)

### real pod debugging is a different job

When the user wants to inspect the target pod environment, processes, namespaces, network stack, or filesystem, the correct backend is Kubernetes debug tooling, not plain `describe`.

Use official `kubectl debug` flows:

- ephemeral debug container attached to the target pod when possible
- copy-of-pod debug when the original pod cannot be modified or when process sharing / deeper inspection is required

Official reference:

- Kubernetes docs: <https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/>

## Runtime Split

### Action 1: `Copy describe command`

Behavior:

- only copy the kubectl command text
- no runtime effects
- no shell creation
- no debug pod creation

### Action 2: `Run debug describe`

Behavior:

- ensure shared cluster debug pod exists and is Ready
- run `kubectl describe ...` inside that pod
- stream stdout/stderr into a dedicated read-only describe panel
- allow rerun and copy output

Backend:

- existing shared debug pod runtime

Why:

- lowest orchestration cost
- no target-pod mutation
- no need for ephemeral container lifecycle
- naturally works for pods, services, deployments, PVC/PV, policies, CRDs, and other resources

### Action 3: `Open pod debug session`

Behavior:

- create a real Kubernetes debug session for the selected pod
- open a dedicated debug workbench, not a copy-action toast
- make the mode explicit in the UI

Backend order:

1. ephemeral debug container with `kubectl debug --target=<container>`
2. fallback to copy-of-pod debug with `kubectl debug --copy-to=... --share-processes`

Why:

- this matches the official Kubernetes model
- target-pod debugging is materially different from cluster-admin shell execution

## Recommended Kubernetes Flows

### Preferred flow for real pod debug

Use ephemeral debug container first:

```bash
kubectl debug -it pod/<pod> -n <namespace> --target=<container> --image=busybox:1.36 -- /bin/sh
```

Use profile only when needed:

- default or `general` for normal debugging
- `sysadmin` only for elevated namespace/capability needs

### Fallback flow

Use copy-of-pod debug when ephemeral containers are blocked or insufficient:

```bash
kubectl debug pod/<pod> -n <namespace> --copy-to=<debug-pod> --share-processes --image=busybox:1.36 -- /bin/sh
```

This should be explicit in the UI because it creates a second pod.

## Product Rules

### Labels and actions

Use these exact separations:

- `Copy describe command`
- `Run debug describe`
- `Copy kubectl debug`
- `Open pod debug session`

Do not overload one label for multiple behaviors.

### Placement

Put runtime-backed actions only in:

- details sheets
- workbench panels
- secondary action menus

Do not make the base table row itself responsible for long-running debug orchestration.

### Output surface

`Run debug describe` should render into a dedicated output panel:

- read-only output
- rerun button
- copy-output button
- error state
- execution metadata: cluster, namespace, resource, started-at

Do not reduce this to a toast or alert message.

## Proposed Architecture

Introduce a shared feature:

- `features/resource-debug-runtime`

Suggested responsibilities:

- ensure shared cluster debug pod
- run commands inside debug pod
- run pod-debug sessions via `kubectl debug`
- expose execution status and streamed output

Suggested public API:

- `runDebugDescribe(args)`
- `startPodDebugSession(args)`
- `stopPodDebugSession(args)`
- `buildDebugDescribeCommand(args)`
- `buildKubectlDebugCommand(args)`

### Shared debug pod path

Use for:

- `describe`
- cluster-admin diagnostic commands
- read-only inspection commands

Keep using existing shell pod lifecycle as the base primitive.

### `kubectl debug` path

Use only for:

- target pod process inspection
- filesystem / namespace debugging
- interactive troubleshooting that needs pod-local context

## Rollout Plan

### `PR1` Shared runtime contract

Deliver:

- `resource-debug-runtime` feature scaffold
- describe execution contract
- pod-debug session contract
- command builders for both paths

Done when:

- both backends have explicit typed boundaries

Status:

- done for `Run debug describe`
- done for `Open pod debug session` with a bounded copy-of-pod flow:
  - `kubectl debug --copy-to=... --share-processes`
  - wait for `Ready`
  - open shell against the debug pod
  - delete the temp debug pod on shell close

### `PR2` Pod details integration

Deliver:

- add `Run debug describe` to pod details/workbench
- add `Open pod debug session` next to existing `Copy kubectl debug`
- route output into dedicated debug describe panel

Done when:

- pod page proves both flows work without changing generic table behavior

Status:

- `Run debug describe` is wired into pod list, pod bulk actions, pod details sheet, and pod data sheet
- the output now renders in a dedicated read-only debug-describe shell mode with:
  - execution metadata
  - rerun
  - copy command
  - copy output
- `Open pod debug session` is wired into the same pod surfaces as an explicit runtime action

### `PR3` Service and workload rollout

Deliver:

- add `Run debug describe` to services, deployments, daemonsets, statefulsets
- no pod-debug session for non-pod resources

Done when:

- shared debug describe flow works across common operational sections

Status:

- done for details-level rollout across:
  - `network`
  - `storage`
  - `access control`
  - `custom resources`
  - generic workload details based on `ResourceDetailsSheet`
    - `jobs`
    - `cronjobs`
    - `replicasets`
    - `statefulsets`
- broader action-menu rollout outside details surfaces is still optional follow-up, not required for this checkpoint

### `PR4` Broad resource rollout

Deliver:

- add debug describe to PVC, PV, policies, CRDs, and other worthwhile details sheets
- keep runtime-bound actions out of cheap summary surfaces unless explicitly opened from details

Done when:

- describe execution is shared and consistent across the app

## Safety Rules

- never show secret values in describe output by default without explicit user action
- never auto-create `sysadmin` debug sessions unless the user chose that mode
- always show whether the session is:
  - shared debug pod
  - ephemeral debug container
  - copy-of-pod debug
- always offer cleanup for copy-of-pod sessions

## Honest Scope

This is not a small rename.

The minimal correct next implementation is:

1. keep `Copy describe command` unchanged
2. build `Run debug describe` on top of the existing shared debug pod
3. add real `Open pod debug session` as a separate pod-only flow using official `kubectl debug`

That is the cleanest path with the lowest architectural waste and the best alignment with Kubernetes debugging semantics.
