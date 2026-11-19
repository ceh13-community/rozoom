import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import SortingButton from "./sorting-button.svelte";

// Layout itself is checked on the built app; this pins the label truncation and the
// tooltip. In table-fixed tables (ConfigMaps, Secrets, CRDs) a label without them ran into
// the next header. The button classes go through cn, which the test setup mocks.
describe("SortingButton", () => {
  it("keeps the label inside its column and names it in the tooltip", () => {
    const { getByRole, getByText } = render(SortingButton, { props: { label: "Namespace" } });

    const button = getByRole("button");
    expect(button).toHaveAttribute("title", "Namespace");
    expect(getByText("Namespace").className).toContain("truncate");
  });

  it("lets the caller replace the tooltip", () => {
    const { getByRole } = render(SortingButton, {
      props: { label: "RV", title: "Resource version" },
    });

    expect(getByRole("button")).toHaveAttribute("title", "Resource version");
  });
});
