# Metrics Sources hardening runbook

This runbook helps avoid false-green health checks and common runtime issues for:

- `metrics-server`
- `kube-state-metrics`
- `node-exporter`
- kubelet/cAdvisor access via API proxy

## 1) metrics-server: production-safe profile (recommended)

Use preferred node address types first and kubelet node status port.

```bash
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/ --force-update
helm repo update metrics-server

helm upgrade --install metrics-server metrics-server/metrics-server \
  --namespace kube-system \
  --create-namespace \
  --set-json 'args=["--kubelet-preferred-address-types=InternalDNS,Hostname,InternalIP,ExternalDNS,ExternalIP","--kubelet-use-node-status-port"]'
```

## 2) metrics-server: temporary compatibility workaround

Use only if kubelet serving certificates are currently invalid for node IP/DNS SAN.

```bash
helm upgrade --install metrics-server metrics-server/metrics-server \
  --namespace kube-system \
  --create-namespace \
  --set-json 'args=["--kubelet-preferred-address-types=InternalDNS,Hostname,InternalIP,ExternalDNS,ExternalIP","--kubelet-use-node-status-port","--kubelet-insecure-tls"]'
```

Security note: `--kubelet-insecure-tls` disables kubelet certificate verification. Treat as temporary.

## 3) kube-state-metrics

Install and verify endpoint payload:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update
helm repo update prometheus-community
helm upgrade --install kube-state-metrics prometheus-community/kube-state-metrics \
  --namespace kube-state-metrics \
  --create-namespace

kubectl -n kube-state-metrics get deploy,pod
kubectl -n kube-state-metrics get --raw /api/v1/namespaces/kube-state-metrics/services/kube-state-metrics:8080/proxy/metrics | head
```

## 4) node-exporter

Install as DaemonSet and verify node coverage:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update
helm repo update prometheus-community
helm upgrade --install prometheus-node-exporter prometheus-community/prometheus-node-exporter \
  --namespace monitoring \
  --create-namespace

kubectl -n monitoring get ds,pod -l app.kubernetes.io/name=prometheus-node-exporter
kubectl get nodes -o name | wc -l
kubectl -n monitoring get pod -l app.kubernetes.io/name=prometheus-node-exporter -o wide | wc -l
```

## 5) TLS SAN root-cause remediation for kubelet

If metrics-server logs include:
`x509: cannot validate certificate ... because it doesn't contain any IP SANs`

preferred long-term fix:

1. Re-issue kubelet serving certificates with correct SAN entries.
2. Ensure node DNS names in cert SAN are resolvable and selected by preferred address types.
3. Remove `--kubelet-insecure-tls` once certs are corrected.

## 6) Validation checklist in UI

In `Metrics Sources Status`, require all of:

- `metrics-server` is `Available`, not partial node coverage.
- `kube-state-metrics` is `Available` with valid Prometheus payload.
- `node-exporter` is `Available` with full node coverage.
- `Kubelet / cAdvisor` is `Available` and metrics text is detected.

If any source is `Unreachable` or `Not found`, treat CPU/memory dashboards as degraded.
