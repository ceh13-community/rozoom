import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import SortingButton from "./sorting-button.svelte";

// Layout itself is checked on the built app; this pins the two label modes. The button
// classes go through cn, which the test setup mocks, so only the label span and the
// tooltip are asserted here.
describe("SortingButton", () => {
  // Content-sized tables (Deployments) and the Pods grid size the column from the label;
  // a truncating label there let the column shrink and cut "Ready" to "Rea...".
  it("shows the full label by default", () => {
    const { getByRole, getByText } = render(SortingButton, { props: { label: "Up-to-date" } });

    expect(getByText("Up-to-date").className).not.toContain("truncate");
    expect(getByRole("button")).not.toHaveAttribute("title");
  });

  // In table-fixed tables (ConfigMaps, Secrets, CRDs) the label cannot widen its column;
  // without truncation it ran into the next header.
  it("cuts the label inside its column and names it in the tooltip when asked to", () => {
    const { getByRole, getByText } = render(SortingButton, {
      props: { label: "Namespace", truncate: true },
    });

    expect(getByRole("button")).toHaveAttribute("title", "Namespace");
    expect(getByText("Namespace").className).toContain("truncate");
  });

  it("lets the caller replace the tooltip", () => {
    const { getByRole } = render(SortingButton, {
      props: { label: "RV", truncate: true, title: "Resource version" },
    });

    expect(getByRole("button")).toHaveAttribute("title", "Resource version");
  });
});
