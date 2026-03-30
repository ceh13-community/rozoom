import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import SectionRuntimeStatus from "./section-runtime-status.svelte";

describe("section runtime status", () => {
  it("renders the last updated label in the runtime shell", () => {
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

    expect(getByText("updated just now")).toBeInTheDocument();
  });

  it("renders a secondary update action alongside the main runtime action", () => {
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
  });
});
