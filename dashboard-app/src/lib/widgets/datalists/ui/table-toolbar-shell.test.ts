import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import TableToolbarShell from "./table-toolbar-shell.svelte";

describe("table toolbar shell", () => {
  it("renders the shared toolbar layout", () => {
    const { container } = render(TableToolbarShell);

    expect(container.firstElementChild).toHaveClass(
      "flex",
      "flex-wrap",
      "items-end",
      "justify-between",
      "gap-3",
      "py-3",
    );
    expect(container.querySelector(".min-w-\\[250px\\]")).toBeInTheDocument();
    expect(container.querySelector(".justify-end")).toBeInTheDocument();
  });
});
