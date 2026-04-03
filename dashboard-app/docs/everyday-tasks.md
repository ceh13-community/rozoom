# Everyday Tasks

Step-by-step guides for the most common Kubernetes operations in ROZOOM.
Each task shows the click path and, where available, the keyboard shortcut.

---

## Scale a deployment

**Goal:** Change the replica count of a deployment (equivalent to `kubectl scale deployment my-api --replicas=5 -n prod`).

1. Navigate to the cluster (or `Cmd+K` -> type cluster name -> Enter)
2. Go to **Deployments** (sidebar link, or `g d`)
3. Find your deployment (use the search filter, or `/` to focus search)
4. Click the **three-dot menu** (right side of the row)
5. Click **Scale** (in the Diagnostics section)
6. Enter the desired replica count -> **Scale**

**Keyboard-only:** `Cmd+K` -> "prod" -> Enter -> `g d` -> `/` -> "my-api" -> click menu -> Scale -> 5 -> Enter.

**Equivalent kubectl:** `kubectl scale deployment my-api --replicas=5 -n prod`

---

## Restart a deployment

**Goal:** Rolling restart without changing config (equivalent to `kubectl rollout restart deployment/my-api -n prod`).

1. Navigate to **Deployments** (`g d`)
2. Find your deployment
3. Click the **three-dot menu**
4. Click **Rollout restart** (in the Rollout section)

**Equivalent kubectl:** `kubectl rollout restart deployment/my-api -n prod`

---

## View pod logs

**Goal:** See real-time logs for a pod (equivalent to `stern my-pod -n prod`).

1. Navigate to **Pods** (`g p`)
2. Find your pod
3. Click the **three-dot menu** -> **Logs**
4. The workbench pane opens with live log streaming
5. Use the search bar to filter log lines
6. Toggle **Live** to start/stop streaming

**Tip:** Logs support ANSI colors. If your app outputs colored logs, they render correctly.

---

## Investigate a failing pod

**Goal:** Understand why a pod is failing - see logs, events, and YAML at once.

1. Navigate to **Pods** (`g p`)
2. Find the failing pod (look for red/yellow status badges)
3. Click the **three-dot menu** -> **Investigate**
4. A dual-pane workbench opens: **logs on the left, YAML on the right**
5. Check events in the YAML pane for scheduling failures, OOM kills, image pull errors

**Equivalent kubectl:**

```
kubectl logs my-pod -n prod
kubectl describe pod my-pod -n prod
kubectl get pod my-pod -n prod -o yaml
```

---

## Check cluster health at a glance

**Goal:** See which clusters need attention across your entire fleet.

1. Open the **Fleet Dashboard** (home page, or `Cmd+K` -> "dashboard")
2. Each cluster card shows:
   - **Health Score** (0-100) - based on real-time signals
   - **Traffic light badges** - green/yellow/red for key checks
   - **Alert count** - if Prometheus/Alertmanager is configured
3. Click a card to drill into that cluster's **Overview**

---

## Switch between clusters quickly

**Option 1: Command Palette**

1. Press `Cmd+K` (or `Ctrl+K` on Linux)
2. Type the cluster name
3. Press Enter

**Option 2: Cluster dropdown**

1. Use the cluster selector dropdown in the top bar
2. Pick the cluster

---

## Cordon and drain a node

**Goal:** Prepare a node for maintenance (equivalent to `kubectl cordon node-1 && kubectl drain node-1`).

1. Navigate to **Nodes** (`g n`)
2. Find the node
3. Click the **three-dot menu**
4. Click **Cordon** (marks node as unschedulable)
5. Click **Drain** (evicts pods safely)
6. After maintenance, click **Uncordon** to resume scheduling

---

## Install a Helm chart

**Goal:** Deploy a new application from the Helm catalog.

1. Navigate to **Helm Catalog** (sidebar -> Cluster Ops -> Helm Catalog)
2. Browse by category (Observability, Security, Databases, etc.)
3. Click a chart to see details
4. Click **Install** and configure values
5. Confirm installation

**Equivalent kubectl:** `helm repo add <repo> <url> && helm install <name> <chart> -n <ns>`

---

## Find problems across all resources

**Goal:** See all unhealthy resources in one place.

1. Navigate to **Global Triage** (sidebar -> Global Triage)
2. The scanner checks 46+ resource types automatically
3. Results sorted by severity score (Critical > Warning > Low)
4. Click any row to see details
5. Use **Group by** to organize by namespace, workload type, or severity

---

## Compare configuration across clusters (drift detection)

**Goal:** Find the cluster that's configured differently from the others.

1. Open the **Fleet Dashboard**
2. Expand **Fleet Control Plane** (click the chevron)
3. The **Fleet Drift Detector** panel shows alignment status
4. Misaligned clusters are highlighted with specific differences

---

## Keyboard shortcut reference

| Shortcut           | Action                    |
| ------------------ | ------------------------- |
| `Cmd+K` / `Ctrl+K` | Open command palette      |
| `Escape`           | Close overlay/dialog      |
| `/`                | Focus search input        |
| `g d`              | Go to Deployments         |
| `g p`              | Go to Pods                |
| `g s`              | Go to StatefulSets        |
| `g a`              | Go to DaemonSets          |
| `g n`              | Go to Nodes               |
| `g j`              | Go to Jobs                |
| `g k`              | Go to CronJobs            |
| `g c`              | Go to ConfigMaps          |
| `g i`              | Go to Ingresses           |
| `g e`              | Go to Services            |
| `g o`              | Go to Overview            |
| `g h`              | Go to Helm                |
| `g v`              | Go to PVCs                |
| `g r`              | Go to ReplicaSets         |
| `j` / `k`          | Navigate table rows       |
| `Enter`            | Open selected row details |
