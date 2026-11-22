import { render, screen, within } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import type { ClusterHealthChecks } from "$features/check-health";
import ClusterScore from "./cluster-score.svelte";

const checks = {
  daemonSets: 0,
  deployments: 0,
  jobs: 0,
  replicaSets: 0,
  pods: 0,
  statefulSets: 0,
  namespaces: [],
  podRestarts: [],
  cronJobs: 0,
  metricsChecks: { endpoints: {} },
  timestamp: 0,
  probesHealth: {
    status: "critical",
    summary: { status: "critical", message: "", total: 2, ok: 1, warning: 0, critical: 1 },
    items: [
      { namespace: "lint", workload: "no-probes", status: "critical" },
      { namespace: "lint", workload: "probed", status: "ok" },
    ],
    updatedAt: 0,
  },
  secretsHygiene: {
    status: "ok",
    summary: { status: "ok", message: "", total: 1, ok: 1, warning: 0, critical: 0 },
    items: [],
    updatedAt: 0,
  },
  networkIsolation: {
    status: "unsupported",
    summary: { status: "unsupported", message: "", total: 0, ok: 0, warning: 0, critical: 0 },
    items: [],
    updatedAt: 0,
  },
} as unknown as ClusterHealthChecks;

// A count-only check next to a check that fails without naming anything.
const countOnlyChecks = {
  ...checks,
  rbacOverview: {
    status: "warning",
    summary: {
      status: "warning",
      message: "",
      totalBindings: 3,
      clusterAdminBindings: 1,
      overprivilegedCount: 1,
      updatedAt: 0,
    },
    updatedAt: 0,
  },
  hpaStatus: {
    status: "warning",
    summary: { status: "warning", message: "", total: 1, ok: 0, warning: 1, critical: 0 },
    items: [],
    updatedAt: 0,
  },
} as unknown as ClusterHealthChecks;

const row = (id: string) => {
  const found = screen
    .getAllByTestId("cluster-score-rule")
    .find((element) => element.getAttribute("data-rule-id") === id);
  if (!found) throw new Error(`no row for ${id}`);
  return found;
};

describe("cluster score rule list", () => {
  it("shows all 16 rules with their verdict, not only the top risks", () => {
    render(ClusterScore, { props: { checks } });
    expect(screen.getAllByTestId("cluster-score-rule")).toHaveLength(16);
    expect(screen.getByTestId("cluster-score-rules").querySelector("summary")?.textContent).toMatch(
      /1 failing, 1 passing, 14\s+not checked/,
    );
  });

  it("names the flagged objects of a failing rule and not the ok ones", () => {
    render(ClusterScore, { props: { checks } });
    const probes = row("probes");
    expect(probes.getAttribute("data-rule-status")).toBe("fail");
    expect(within(probes).getByText("Fail")).toBeTruthy();
    expect(within(probes).getByText("lint/no-probes")).toBeTruthy();
    expect(within(probes).queryByText("lint/probed")).toBeNull();
  });

  it("explains a missing object list only for count-only checks", () => {
    render(ClusterScore, { props: { checks: countOnlyChecks } });
    expect(
      within(row("rbac-overprivileged")).getByText("This check reports a count, not names."),
    ).toBeTruthy();
    expect(within(row("hpa-health")).getByText("Objects not listed.")).toBeTruthy();
  });

  it("tells a passed rule apart from one whose check could not run", () => {
    render(ClusterScore, { props: { checks } });
    expect(row("secrets").getAttribute("data-rule-status")).toBe("pass");
    expect(within(row("secrets")).getByText("Pass")).toBeTruthy();
    const network = row("network-policy");
    expect(network.getAttribute("data-rule-status")).toBe("not-checked");
    expect(within(network).getByText("Not checked")).toBeTruthy();
  });
});
