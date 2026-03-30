import { load as parseYaml } from "js-yaml";

type YamlDoc = {
  metadata?: {
    resourceVersion?: string;
  };
};

export type DriftCheckResult = {
  hasDrift: boolean;
  originalResourceVersion: string | null;
  currentResourceVersion: string | null;
};

function getResourceVersion(yamlText: string): string | null {
  try {
    const parsed = parseYaml(yamlText) as YamlDoc | null;
    const rv = parsed?.metadata?.resourceVersion;
    return typeof rv === "string" && rv.trim().length > 0 ? rv : null;
  } catch {
    return null;
  }
}

export function checkYamlDrift(originalYaml: string, currentYaml: string): DriftCheckResult {
  const originalResourceVersion = getResourceVersion(originalYaml);
  const currentResourceVersion = getResourceVersion(currentYaml);

  return {
    hasDrift: Boolean(
      originalResourceVersion &&
        currentResourceVersion &&
        originalResourceVersion !== currentResourceVersion,
    ),
    originalResourceVersion,
    currentResourceVersion,
  };
}

export function buildDriftMessage(result: DriftCheckResult) {
  if (!result.hasDrift) return null;
  const from = result.originalResourceVersion ?? "?";
  const to = result.currentResourceVersion ?? "?";
  return `Resource changed in cluster since you opened this YAML (rv ${from} -> ${to}). Reload from cluster or rebase your edits before Apply.`;
}
