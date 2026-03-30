export const STATUS_CLASSES = {
  ok: "bg-emerald-700 text-white shadow-sm hover:bg-emerald-700",
  warning: "bg-amber-600 text-white shadow-sm hover:bg-amber-600",
  error: "bg-rose-700 text-white shadow-sm hover:bg-rose-700",
  unknown: "bg-slate-600 text-white shadow-sm hover:bg-slate-600",
} as const;

export const MAX_HEALTH_CHECK_CACHE_TIME = 1 * 60 * 60;
export const MAX_HEALTH_CHECKS_PER_CLUSTER = 50;
export const WATCHERS_INTERVAL = 60 * 1000;
