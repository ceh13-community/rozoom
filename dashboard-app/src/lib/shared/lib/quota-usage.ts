// Used against hard limits of a ResourceQuota, for the list column and the details panel.

const BINARY: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};
const DECIMAL: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

/** A Kubernetes quantity ("250m", "2Gi", "1.5", "1e3") in base units, or null. */
export function parseQuantity(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  const match = /^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)([a-zA-Z]{0,2})$/.exec(text);
  if (!match) return null;
  const amount = Number(match[1]);
  const suffix = match[2];
  if (!suffix) return amount;
  if (suffix in BINARY) return amount * BINARY[suffix];
  if (suffix in DECIMAL) return amount * DECIMAL[suffix];
  return null;
}

export type QuotaUsageItem = {
  resource: string;
  label: string;
  used: string;
  hard: string;
  /** used / hard, 0..1 and above when over; null when it cannot be computed. */
  ratio: number | null;
};

const LABELS: Record<string, string> = {
  "requests.cpu": "CPU requests",
  "limits.cpu": "CPU limits",
  cpu: "CPU",
  "requests.memory": "Memory requests",
  "limits.memory": "Memory limits",
  memory: "Memory",
  pods: "Pods",
};

// CPU, memory and pods first: what a person checks a quota for.
const ORDER = ["requests.cpu", "cpu", "limits.cpu", "requests.memory", "memory", "limits.memory"];

function rank(resource: string) {
  const index = ORDER.indexOf(resource);
  if (index >= 0) return index;
  return resource === "pods" ? ORDER.length : ORDER.length + 1;
}

/** Every hard limit of the quota with what is used of it, most looked-at first. */
export function quotaUsage(quota: { status?: unknown; spec?: unknown }): QuotaUsageItem[] {
  const status = (quota.status ?? {}) as {
    hard?: Record<string, string>;
    used?: Record<string, string>;
  };
  const specHard = ((quota.spec ?? {}) as { hard?: Record<string, string> }).hard ?? {};
  const hard = status.hard ?? specHard;
  const used = status.used ?? {};
  return Object.keys(hard)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((resource) => {
      const hardValue = parseQuantity(hard[resource]);
      // Not reported yet (the quota controller has not filled status.used): unknown, not
      // zero. "0 / 4 (0%)" in green read as a measured, empty quota.
      const usedText = used[resource] as string | undefined;
      const usedValue = usedText === undefined ? null : parseQuantity(usedText);
      return {
        resource,
        label: LABELS[resource] ?? resource,
        used: usedText ?? "-",
        hard: hard[resource],
        ratio:
          hardValue !== null && usedValue !== null && hardValue > 0 ? usedValue / hardValue : null,
      };
    });
}

/** "CPU requests 225m / 2 (11%)" */
export function formatQuotaUsageItem(item: QuotaUsageItem) {
  const percent = item.ratio === null ? "" : ` (${Math.round(item.ratio * 100)}%)`;
  return `${item.label} ${item.used} / ${item.hard}${percent}`;
}
