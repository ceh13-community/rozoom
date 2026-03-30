# Kubernetes API deprecation exposure

This guide explains how the dashboard reports deprecated or removed Kubernetes API versions and
how to run full scans before upgrades.

## Why it matters

Deprecated API versions can be removed in newer Kubernetes releases. If workloads or Helm charts
still use them, upgrades can break deployments or controllers. Regular scans reduce upgrade risk.

## Data sources and trust levels

The panel combines multiple live sources:

- **Observed API requests** from `apiserver_requested_deprecated_apis` metric.
- **Full cluster scan (Pluto)** for object-level deprecated API usage.
- **Helm template scan (Pluto)** for chart-level deprecated API usage.

Trust badge meanings:

- **Full coverage**: full cluster scan + Helm scan succeeded.
- **Mixed coverage**: only one full source succeeded.
- **Observed only**: only metric source is available.
- **Limited**: no reliable source available.

If any source fails, the panel shows explicit warnings/errors instead of silent fallback.

## Recommended tools

- **Pluto** (Fairwinds) to scan live resources, Helm releases, or Git repositories.
- **kubectl api-resources** to inspect supported API versions on the target cluster.

## Configure target Kubernetes versions

Pick a target version aligned with your upgrade plan (for example, `v1.26.0`).

```bash
pluto version
# Example target version flag
pluto detect-api-resources --target-versions v1.26.0
```

## Scan live cluster resources

```bash
pluto detect-api-resources -o json --target-versions v1.26.0
```

This returns deprecated and removed API usages with suggested replacements.

## Scan Helm releases

```bash
pluto detect-helm --target-versions v1.26.0
```

## Scan Git or chart repositories

```bash
pluto detect-files -d ./charts --target-versions v1.26.0
```

## Verify supported APIs on the cluster

```bash
kubectl api-resources
```

Use this to compare cluster support with your manifests and Helm templates.

## Status interpretation

- **OK**: No deprecated API versions detected.
- **Warning**: Deprecated APIs found but not yet removed in your target version.
- **Critical**: APIs already removed for your configured target Kubernetes version.

## Remediation checklist

1. Replace deprecated `apiVersion` values with the recommended replacements.
2. Update Helm chart templates and values for new API versions.
3. Re-run Pluto scans until results return **OK**.
4. Validate on a staging cluster running the target Kubernetes version.

## Troubleshooting

- **Scan unavailable**: one or more sources cannot reach the cluster or required tools are missing.
- **Need configuration**: Set the target Kubernetes version and ensure Pluto's API data is up to date.
- Observed metric source only tracks requests seen since apiserver restart.
