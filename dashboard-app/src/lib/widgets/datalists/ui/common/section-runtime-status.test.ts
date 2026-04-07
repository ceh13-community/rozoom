import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { showRuntimeDiagnostics } from "$features/check-health/model/runtime-diagnostics-preferences";
import SectionRuntimeStatus from "./section-runtime-status.svelte";

describe("section runtime status", () => {
  it("renders the last updated label in compact mode (default)", () => {
    const { getByText } = render(SectionRuntimeStatus, {
      props: {
        sectionLabel: "Namespaces Runtime Status",
        profileLabel: "Balanced profile",
        sourceState: "cached",
        mode: "stream",
        budgetSummary: "sync 30s",
        lastUpdatedLabel: "updated just now",
        detail: "Namespace sync is healthy.",
      },
    });

    expect(getByText(/updated just now/)).toBeInTheDocument();
    expect(getByText("Cached")).toBeInTheDocument();
  });

  it("renders verbose details when runtime diagnostics enabled", async () => {
    showRuntimeDiagnostics.set(true);
    // Wait for store update to propagate
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const { getByText } = render(SectionRuntimeStatus, {
        props: {
          sectionLabel: "Namespaces Runtime Status",
          profileLabel: "Balanced profile",
          sourceState: "cached",
          mode: "stream",
          budgetSummary: "sync 30s",
          lastUpdatedLabel: "updated just now",
          detail: "Namespace sync is healthy.",
          reason: "Watcher is running normally.",
        },
      });

      expect(getByText("Namespaces Runtime Status")).toBeInTheDocument();
      expect(getByText("Watcher is running normally.")).toBeInTheDocument();
    } finally {
      showRuntimeDiagnostics.set(false);
    }
  });

  it("renders a secondary update action alongside the main runtime action", () => {
    showRuntimeDiagnostics.set(true);
    try {
      const { getByRole } = render(SectionRuntimeStatus, {
        props: {
          sectionLabel: "Namespaces Runtime Status",
          profileLabel: "Balanced profile",
          sourceState: "stale",
          mode: "stream",
          budgetSummary: "sync 30s",
          detail: "Namespaces data has exceeded the freshness budget and should be refreshed.",
          secondaryActionLabel: "Update",
          onSecondaryAction: () => {},
          actionLabel: "Pause section",
          onAction: () => {},
        },
      });

      expect(getByRole("button", { name: "Update" })).toBeInTheDocument();
      expect(getByRole("button", { name: "Pause section" })).toBeInTheDocument();
    } finally {
      showRuntimeDiagnostics.set(false);
    }
  });
});
