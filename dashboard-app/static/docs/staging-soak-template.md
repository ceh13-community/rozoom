# Staging Soak Template

Date: 2026-01-08

Use this template for every release-candidate soak. Fill it in with real timestamps and evidence.

## Session

- environment:
- build / commit:
- operator:
- cluster count:
- start time:
- end time:

## Navigation Soak

- repeated cluster switching for 30-60 min:
- repeated section switching for 30-60 min:
- namespace filter churn:
- runtime profile changes exercised:

## Error Budget Notes

- global degraded banners seen:
- repeated watcher transport errors:
- namespace load failures:
- metrics-source failures:
- pod snapshot failures:

## Sentry

- release tag:
- new issues:
- regressions against previous release:
- ignored known issues:

## Packaging

- packaged build used:
- logs path verified:
- bundled binaries verified:

## Sign-Off

- release candidate status:
- blockers:
- follow-ups:

## Current Local Evidence

- status: `partial`
- environment:
  - local desktop runtime
  - healthy clusters observed: `minikube`, `arn:aws:eks:us-east-2:058264254041:cluster/test-7env`
- build / commit:
  - version: `0.7.1`
  - pushed release-hardening baseline: `09ec683`
- operator:
  - local operator pass completed on `2026-01-08`
- observed soak-like activity already exercised:
  - repeated section and route switching during release hardening
  - workbench tab churn for logs / YAML / investigate / debug flows
  - rollout pause/resume/restart validation
  - pod debug session self-heal validation
  - backup / Velero validation
- current blockers to call this a completed staging soak:
  - no single continuous timestamped staging session recorded in this document yet
  - no explicit 30-60 minute cluster-switching soak evidence attached yet
  - no Sentry staging event evidence attached yet
