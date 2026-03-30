import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import PortForwardBrowserTab from "./port-forward-browser-tab.svelte";

describe("port-forward-browser-tab", () => {
  it("renders a disabled stopping action while stop is in progress", async () => {
    const onStop = vi.fn();
    const { getByRole } = render(PortForwardBrowserTab, {
      props: {
        title: "Web api",
        url: "http://127.0.0.1:8080",
        message: "Stopping port-forward...",
        loading: true,
        onRefresh: vi.fn(),
        onStop,
        stopBusy: true,
        stopLabel: "Stopping...",
      },
    });

    const stopButton = getByRole("button", { name: "Stopping..." });
    expect(stopButton).toBeDisabled();

    expect(onStop).not.toHaveBeenCalled();
  });
});
