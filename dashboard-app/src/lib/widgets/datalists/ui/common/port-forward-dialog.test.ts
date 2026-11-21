import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import PortForwardDialog from "./port-forward-dialog.svelte";
import type { PortForwardTarget } from "./model/port-forward-target";

const podWithPorts: PortForwardTarget = {
  kind: "pod",
  namespace: "shop",
  name: "web-1",
  ports: [
    { port: 80, name: "http", container: "nginx", scheme: "http" },
    { port: 8443, name: "", container: "proxy", scheme: "https" },
  ],
};
const podWithoutPorts: PortForwardTarget = {
  kind: "pod",
  namespace: "default",
  name: "busybox",
  ports: [],
};

async function renderDialog(target: PortForwardTarget, used: number[] = []) {
  const onConfirm = vi.fn();
  // `props`: the prop named `target` clashes with Svelte's mount option of that name.
  render(PortForwardDialog, {
    props: {
      open: true,
      target,
      usedLocalPorts: new Set(used),
      onConfirm,
      onCancel: vi.fn(),
    },
  });
  await tick();
  return onConfirm;
}

const localInput = () => screen.getByLabelText("Local port") as HTMLInputElement;
const startButton = () => screen.getByRole("button", { name: /^Start/ });

describe("port-forward dialog", () => {
  it("preselects the first declared port and an unprivileged local port", async () => {
    const onConfirm = await renderDialog(podWithPorts);
    expect(localInput().value).toBe("30080");
    await fireEvent.click(startButton());
    expect(onConfirm).toHaveBeenCalledWith({
      remotePort: 80,
      localPort: 30080,
      scheme: "http",
      openWeb: true,
    });
  });

  it("skips a local port another forward holds", async () => {
    const onConfirm = await renderDialog(podWithPorts, [30080]);
    expect(localInput().value).toBe("30081");
    await fireEvent.click(startButton());
    expect(onConfirm.mock.calls[0][0].localPort).toBe(30081);
  });

  it("switches to another declared port and its scheme", async () => {
    const onConfirm = await renderDialog(podWithPorts);
    await fireEvent.click(screen.getByRole("radio", { name: /8443/ }));
    await tick();
    expect(localInput().value).toBe("8443");
    await fireEvent.click(startButton());
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ remotePort: 8443, scheme: "https" });
  });

  it("forwards a pod without declared ports to a typed port", async () => {
    const onConfirm = await renderDialog(podWithoutPorts);
    expect(screen.getByText(/No TCP ports are declared/)).toBeTruthy();
    await fireEvent.click(startButton());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("remote port");

    await fireEvent.input(screen.getByLabelText("Remote port"), { target: { value: "5000" } });
    await tick();
    expect(localInput().value).toBe("5000");
    await fireEvent.click(startButton());
    expect(onConfirm).toHaveBeenCalledWith({
      remotePort: 5000,
      localPort: 5000,
      scheme: "http",
      openWeb: true,
    });
  });

  it("keeps a local port the user typed and refuses one already in use", async () => {
    const onConfirm = await renderDialog(podWithPorts, [31000]);
    await fireEvent.input(localInput(), { target: { value: "31000" } });
    await tick();
    await fireEvent.click(screen.getByRole("radio", { name: /8443/ }));
    await tick();
    expect(localInput().value).toBe("31000");
    await fireEvent.click(startButton());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("31000");
  });

  it("can start without opening the page", async () => {
    const onConfirm = await renderDialog(podWithPorts);
    await fireEvent.click(screen.getByRole("checkbox", { name: /Open the page/ }));
    await fireEvent.click(startButton());
    expect(onConfirm.mock.calls[0][0].openWeb).toBe(false);
  });
});
