import { render } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ActionNotificationBar from "./action-notification-bar.svelte";

describe("action-notification-bar", () => {
  it("renders success notification", async () => {
    const { findByText } = render(ActionNotificationBar, {
      props: {
        notification: { type: "success", message: "Pod deleted." },
        onDismiss: () => {},
      },
    });
    expect(await findByText("Pod deleted.")).toBeInTheDocument();
  });

  it("renders error with detail", async () => {
    const { findByText } = render(ActionNotificationBar, {
      props: {
        notification: { type: "error", message: "Failed", detail: "timeout" },
        onDismiss: () => {},
      },
    });
    expect(await findByText("Failed")).toBeInTheDocument();
    expect(await findByText("timeout")).toBeInTheDocument();
  });

  it("renders nothing when notification is null", () => {
    const { container } = render(ActionNotificationBar, {
      props: { notification: null, onDismiss: () => {} },
    });
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("has dismiss button", async () => {
    const { findByLabelText } = render(ActionNotificationBar, {
      props: {
        notification: { type: "warning", message: "Warning" },
        onDismiss: () => {},
      },
    });
    expect(await findByLabelText("Dismiss notification")).toBeInTheDocument();
  });
});
