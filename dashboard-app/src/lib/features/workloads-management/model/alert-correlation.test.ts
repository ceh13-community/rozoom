import { describe, expect, it } from "vitest";
import { correlateAlerts } from "./alert-correlation";

describe("alert-correlation", () => {
  const alert = (name: string, ns: string, startsAt: string, severity = "warning") => ({
    name,
    namespace: ns,
    severity,
    status: "firing",
    startsAt,
    message: `${name} alert`,
    labels: { alertname: name, namespace: ns, severity },
  });

  it("groups alerts within time window", () => {
    const result = correlateAlerts([
      alert("cpu-high", "prod", "2026-03-21T10:00:00Z"),
      alert("memory-high", "prod", "2026-03-21T10:02:00Z"),
      alert("disk-full", "prod", "2026-03-21T10:03:00Z"),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].alerts).toHaveLength(3);
    expect(result.correlatedAlerts).toBe(3);
  });

  it("separates alerts from different namespaces", () => {
    const result = correlateAlerts([
      alert("cpu-high", "prod", "2026-03-21T10:00:00Z"),
      alert("cpu-high", "staging", "2026-03-21T10:00:00Z"),
    ]);
    expect(result.groups).toHaveLength(0);
    expect(result.isolatedAlerts).toBe(2);
  });

  it("separates alerts outside time window", () => {
    const result = correlateAlerts([
      alert("a", "prod", "2026-03-21T10:00:00Z"),
      alert("b", "prod", "2026-03-21T11:00:00Z"),
    ]);
    expect(result.groups).toHaveLength(0);
  });

  it("determines group severity from worst alert", () => {
    const result = correlateAlerts([
      alert("warn", "prod", "2026-03-21T10:00:00Z", "warning"),
      alert("crit", "prod", "2026-03-21T10:01:00Z", "critical"),
    ]);
    expect(result.groups[0].severity).toBe("critical");
  });

  it("calculates incident score", () => {
    const result = correlateAlerts([
      alert("a", "prod", "2026-03-21T10:00:00Z"),
      alert("b", "prod", "2026-03-21T10:01:00Z"),
      alert("c", "dev", "2026-03-21T10:00:00Z"),
    ]);
    // 2 correlated out of 3
    expect(result.incidentScore).toBe(67);
  });
});
