import type { ClusterHealthChecks } from "./types";

export type DiagnosticsScope = "config" | "health";

function hasLegacyConfigDiagnostics(check: ClusterHealthChecks | null | undefined): boolean {
  if (!check) return false;

  return Boolean(
    check.resourcesHygiene ||
      check.hpaStatus ||
      check.probesHealth ||
      check.podQos ||
      check.vpaStatus ||
      check.topologyHa ||
      check.pdbStatus ||
      check.priorityStatus ||
      check.podSecurity ||
      check.networkIsolation ||
      check.secretsHygiene ||
      check.securityHardening,
  );
}

function hasLegacyHealthDiagnostics(check: ClusterHealthChecks | null | undefined): boolean {
  if (!check) return false;

  return Boolean(
    check.apiServerHealth ||
      check.apiServerLatency ||
      check.certificatesHealth ||
      check.podIssues ||
      check.admissionWebhooks ||
      check.warningEvents ||
      check.blackboxProbes ||
      check.apfHealth ||
      check.etcdHealth,
  );
}

export function getDiagnosticsScopeLoadedAt(
  check: ClusterHealthChecks | null | undefined,
  scope: DiagnosticsScope,
): number {
  if (!check) return 0;

  const marker =
    scope === "config"
      ? check.diagnosticsSnapshots?.configLoadedAt
      : check.diagnosticsSnapshots?.healthLoadedAt;
  if (typeof marker === "number" && marker > 0) {
    return marker;
  }

  const hasLegacyScope =
    scope === "config" ? hasLegacyConfigDiagnostics(check) : hasLegacyHealthDiagnostics(check);
  if (!hasLegacyScope) {
    return 0;
  }

  return typeof check.timestamp === "number" ? check.timestamp : 0;
}

export function hasLoadedDiagnosticsScope(
  check: ClusterHealthChecks | null | undefined,
  scope: DiagnosticsScope,
): boolean {
  return getDiagnosticsScopeLoadedAt(check, scope) > 0;
}

export function hasFreshDiagnosticsScope(
  check: ClusterHealthChecks | null | undefined,
  scope: DiagnosticsScope,
  ttlMs: number,
  now = Date.now(),
): boolean {
  const loadedAt = getDiagnosticsScopeLoadedAt(check, scope);
  return loadedAt > 0 && now - loadedAt < ttlMs;
}
