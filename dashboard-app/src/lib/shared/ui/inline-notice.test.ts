import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import InlineNotice from "./inline-notice.svelte";

describe("inline-notice", () => {
  it("renders destructive variant styling and content", () => {
    const { getByRole, getByText } = render(InlineNotice, {
      props: {
        title: "Action failed",
        variant: "destructive",
        message: "Request timed out.",
      },
    });

    expect(getByRole("alert")).toHaveAttribute("data-variant", "destructive");
    expect(getByText("Action failed")).toBeInTheDocument();
    expect(getByText("Request timed out.")).toBeInTheDocument();
  });

  it("calls onDismiss when dismiss button is clicked", async () => {
    const onDismiss = vi.fn();
    const { getByRole } = render(InlineNotice, {
      props: {
        title: "Warning",
        dismissible: true,
        onDismiss,
        message: "Close me.",
      },
    });

    await fireEvent.click(getByRole("button", { name: "Dismiss notification" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
