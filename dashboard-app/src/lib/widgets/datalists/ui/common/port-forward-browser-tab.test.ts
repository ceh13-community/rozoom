import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import PortForwardBrowserTab from "./port-forward-browser-tab.svelte";
import type { PortForwardStatus } from "$shared/lib/port-forward-status";

const status = (over: Partial<PortForwardStatus> = {}): PortForwardStatus => ({
  state: "active",
  label: "Active",
  startedAt: Date.now() - 125_000,
  closedAt: null,
  connections: 4,
  detail: null,
  ...over,
});

function props(over: Record<string, unknown> = {}) {
  return {
    title: "Web shop/web-a",
    url: "http://127.0.0.1:30080",
    message: "Forwarding 30080:80",
    onRefresh: vi.fn(),
    onStop: vi.fn(),
    ...over,
  };
}

describe("port-forward tab", () => {
  it("without a status it is the strip alone, as the Services panel had it", () => {
    const view = render(PortForwardBrowserTab, { props: props() });
    expect(view.getByText("Forwarding 30080:80")).toBeInTheDocument();
    expect(view.queryByTestId("port-forward-status")).toBeNull();
    expect(view.queryByTestId("port-forward-log")).toBeNull();
  });

  it("shows the tunnel state, its uptime, the connection count and the kubectl lines", () => {
    const view = render(PortForwardBrowserTab, {
      props: props({
        status: status(),
        logLines: [
          "14:05:09  Forwarding from 127.0.0.1:30080 -> 80",
          "14:05:20  Handling connection for 30080",
        ],
      }),
    });
    const line = view.getByTestId("port-forward-status");
    expect(line).toHaveTextContent("Active");
    expect(line).toHaveTextContent(/up 2m 0[45]s/);
    expect(line).toHaveTextContent("4 connections");
    expect(view.getByTestId("port-forward-log")).toHaveTextContent("Handling connection for 30080");
  });

  it("a stopped tunnel says how long it ran, an error shows kubectl's line", () => {
    const view = render(PortForwardBrowserTab, {
      props: props({
        status: status({
          state: "error",
          label: "Failed",
          closedAt: Date.now() - 100_000,
          detail: "error: lost connection to pod",
        }),
      }),
    });
    const line = view.getByTestId("port-forward-status");
    expect(line).toHaveTextContent("Failed");
    expect(line).toHaveTextContent(/ran 2[45]s/);
    expect(line).toHaveTextContent("error: lost connection to pod");
    expect(view.getByTestId("port-forward-log")).toHaveTextContent("No output from kubectl yet.");
  });

  it("Test runs one request and shows the code and the time, or the failure", async () => {
    const onTest = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, ms: 12, error: null })
      .mockResolvedValueOnce({ ok: false, status: null, ms: 5000, error: "No answer within 5 s" });
    const view = render(PortForwardBrowserTab, { props: props({ status: status(), onTest }) });

    await fireEvent.click(view.getByRole("button", { name: "Test" }));
    await waitFor(() =>
      expect(view.getByTestId("port-forward-test-result")).toHaveTextContent("HTTP 200 in 12 ms"),
    );
    await fireEvent.click(view.getByRole("button", { name: "Test" }));
    await waitFor(() =>
      expect(view.getByTestId("port-forward-test-result")).toHaveTextContent(
        "No answer within 5 s (5000 ms)",
      ),
    );
    expect(onTest).toHaveBeenCalledTimes(2);
  });

  it("Test is not offered for a stopped tunnel", () => {
    const view = render(PortForwardBrowserTab, {
      props: props({ status: status({ state: "stopped", label: "Stopped" }), onTest: vi.fn() }),
    });
    expect(view.getByRole("button", { name: "Test" })).toBeDisabled();
  });
});

describe("port-forward tab: https and timers", () => {
  it("Test is off for an https forward, with the reason next to the button", () => {
    const onTest = vi.fn();
    const view = render(PortForwardBrowserTab, {
      props: props({ url: "https://127.0.0.1:30443", status: status(), onTest }),
    });
    expect(view.getByRole("button", { name: "Test" })).toBeDisabled();
    expect(view.getByTestId("port-forward-test-unavailable")).toHaveTextContent(
      "Test checks http forwards only",
    );
    expect(onTest).not.toHaveBeenCalled();
  });

  it("the uptime ticker is cleared when the tab goes away or the tunnel stops", async () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearInterval");
    try {
      const view = render(PortForwardBrowserTab, { props: props({ status: status() }) });
      await vi.advanceTimersByTimeAsync(2_100);
      expect(clear).not.toHaveBeenCalled();

      await view.rerender(props({ status: status({ state: "stopped", label: "Stopped" }) }));
      expect(clear).toHaveBeenCalledTimes(1);

      await view.rerender(props({ status: status() }));
      view.unmount();
      expect(clear).toHaveBeenCalledTimes(2);
    } finally {
      clear.mockRestore();
      vi.useRealTimers();
    }
  });
});
