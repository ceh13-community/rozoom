export interface DaysSeverity {
  badge: string;
  label: "unknown" | "expired" | "critical" | "warning" | "soon" | "ok";
  tooltip: string;
}

/** Bucket the number of days-until-expiry into a user-facing severity. */
export function daysSeverity(days?: number): DaysSeverity {
  if (days === undefined || !Number.isFinite(days)) {
    return { badge: "bg-slate-500 text-white", label: "unknown", tooltip: "Expiry unknown" };
  }
  const d = Math.floor(days);
  if (d < 0) {
    return {
      badge: "bg-rose-700 text-white",
      label: "expired",
      tooltip: `Expired ${Math.abs(d)} day(s) ago - imminent outage risk`,
    };
  }
  if (d <= 7) {
    return {
      badge: "bg-rose-600 text-white",
      label: "critical",
      tooltip: `Expires in ${d} day(s) - rotate immediately`,
    };
  }
  if (d <= 30) {
    return {
      badge: "bg-orange-500 text-white",
      label: "warning",
      tooltip: `Expires in ${d} day(s) - plan rotation this week`,
    };
  }
  if (d <= 90) {
    return {
      badge: "bg-amber-500 text-black",
      label: "soon",
      tooltip: `Expires in ${d} day(s) - schedule rotation within the month`,
    };
  }
  return {
    badge: "bg-emerald-600 text-white",
    label: "ok",
    tooltip: `Expires in ${d} day(s) - healthy`,
  };
}
