/**
 * Helm Release Diff (#22)
 *
 * Compares installed Helm release values vs chart defaults.
 */

export type HelmValueDiff = {
  key: string;
  installed: string;
  chartDefault: string;
  customized: boolean;
};
export type HelmReleaseDiffResult = {
  releaseName: string;
  diffs: HelmValueDiff[];
  customizedCount: number;
  totalKeys: number;
  customizationPercent: number;
};

function flattenObject(obj: Record<string, unknown>, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of flattenObject(value as Record<string, unknown>, fullKey)) {
        result.set(k, v);
      }
    } else {
      result.set(fullKey, JSON.stringify(value));
    }
  }
  return result;
}

export function diffHelmRelease(
  releaseName: string,
  installedValues: Record<string, unknown>,
  chartDefaults: Record<string, unknown>,
): HelmReleaseDiffResult {
  const installed = flattenObject(installedValues);
  const defaults = flattenObject(chartDefaults);
  const allKeys = new Set([...installed.keys(), ...defaults.keys()]);
  const diffs: HelmValueDiff[] = [];

  for (const key of allKeys) {
    const instVal = installed.get(key) ?? "-";
    const defVal = defaults.get(key) ?? "-";
    diffs.push({ key, installed: instVal, chartDefault: defVal, customized: instVal !== defVal });
  }

  diffs.sort((a, b) =>
    a.customized === b.customized ? a.key.localeCompare(b.key) : a.customized ? -1 : 1,
  );
  const customized = diffs.filter((d) => d.customized).length;

  return {
    releaseName,
    diffs,
    customizedCount: customized,
    totalKeys: diffs.length,
    customizationPercent: diffs.length > 0 ? Math.round((customized / diffs.length) * 100) : 0,
  };
}
