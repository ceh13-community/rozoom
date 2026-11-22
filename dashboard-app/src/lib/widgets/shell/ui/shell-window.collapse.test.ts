import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront: vi.fn() }));
vi.mock("$shared/lib/confirm-action", () => ({ confirmAction: vi.fn(async () => true) }));

import ShellWindow from "./shell-window.svelte";

const pod = {
  metadata: { name: "redis-cache-redis-ha-5d99cd89cf-jm9t6", namespace: "checkout" },
  spec: { containers: [{ name: "redis-ha" }] },
} as never;

const panel = () => screen.getByLabelText("Minimize shell").closest("[style]") as HTMLElement;

describe("minimized pod shell", () => {
  it("keeps Expand and Close on the card and docks it off the sidebar", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    render(ShellWindow, {
      props: {
        windowState: { id: "s1", clusterId: "c1", targetPod: pod, podSessionMode: "exec" },
        windowIndex: 0,
      },
    });
    const card = panel();
    await fireEvent.click(screen.getByLabelText("Minimize shell"));

    // One row: the session line that pushed the buttons out of the card is gone.
    expect(screen.queryByTestId("pod-session-line")).toBeNull();
    expect(screen.getByLabelText("Expand shell")).toBeInTheDocument();
    expect(screen.getByLabelText("Close Shell")).toBeInTheDocument();
    // Bottom-right, not at the top-left corner over the sidebar, and above the toasts.
    expect(card.style.left).toBe(`${1920 - 360 - 16}px`);
    // Above the toast zone (148 px) that svelte-sonner uses bottom-right.
    expect(card.style.top).toBe(`${1000 - 148 - 64}px`);

    await fireEvent.click(screen.getByLabelText("Expand shell"));
    expect(screen.getByLabelText("Minimize shell")).toBeInTheDocument();
    expect(await screen.findByTestId("pod-session-line")).toBeInTheDocument();
  });

  it("opens beside the sidebars, not over them", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    const rail = document.createElement("aside");
    const menu = document.createElement("aside");
    rail.getBoundingClientRect = () => ({ left: 0, right: 40, width: 40 }) as DOMRect;
    menu.getBoundingClientRect = () => ({ left: 40, right: 290, width: 250 }) as DOMRect;
    document.body.append(rail, menu);
    render(ShellWindow, {
      props: {
        windowState: { id: "s3", clusterId: "c-new", targetPod: pod, podSessionMode: "exec" },
        windowIndex: 0,
      },
    });
    expect(panel().style.left).toBe("306px");
    rail.remove();
    menu.remove();
  });

  it("minimizes from full screen", async () => {
    render(ShellWindow, {
      props: {
        windowState: { id: "s2", clusterId: "c1", targetPod: pod, podSessionMode: "exec" },
        windowIndex: 0,
      },
    });
    await fireEvent.click(screen.getByLabelText("Maximize shell"));
    await fireEvent.click(screen.getByLabelText("Minimize shell"));
    expect(screen.getByLabelText("Expand shell")).toBeInTheDocument();
  });
});
