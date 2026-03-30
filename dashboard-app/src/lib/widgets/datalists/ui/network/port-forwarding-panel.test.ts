import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortForwardingPanel from "./port-forwarding-panel.svelte";

type Subscriber<T> = (value: T) => void;

function createStore<T>(initial: T) {
  let value = initial;
  const subscribers = new Set<Subscriber<T>>();
  return {
    set(next: T) {
      value = next;
      for (const subscriber of subscribers) subscriber(value);
    },
    subscribe(subscriber: Subscriber<T>) {
      subscriber(value);
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
}

const mockNamespace = vi.hoisted(() => createStore("default"));
const mockPortForwardState = vi.hoisted(() => createStore({}));
const mockStartPortForward = vi.hoisted(() => vi.fn());
const mockStopPortForward = vi.hoisted(() => vi.fn());
const mockKubectlJson = vi.hoisted(() => vi.fn());
const mockOpenExternalUrl = vi.hoisted(() => vi.fn());
const mockOpenInAppUrl = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
const mockIsTauriAvailable = vi.hoisted(() => vi.fn(() => true));

vi.mock("svelte-sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock("$features/namespace-management", () => ({
  selectedNamespace: mockNamespace,
}));

vi.mock("$shared/api/port-forward", () => ({
  activePortForwards: mockPortForwardState,
  startPortForward: mockStartPortForward,
  stopPortForward: mockStopPortForward,
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlJson: mockKubectlJson,
}));

vi.mock("$shared/api/in-app-browser", () => ({
  openExternalUrl: mockOpenExternalUrl,
  openInAppUrl: mockOpenInAppUrl,
}));

vi.mock("$shared/lib/tauri-runtime", () => ({
  isTauriAvailable: mockIsTauriAvailable,
}));

describe("port-forwarding-panel", () => {
  beforeEach(() => {
    mockNamespace.set("default");
    mockPortForwardState.set({});
    mockStartPortForward.mockReset();
    mockStopPortForward.mockReset();
    mockKubectlJson.mockReset();
    mockOpenExternalUrl.mockReset();
    mockOpenInAppUrl.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockIsTauriAvailable.mockReset();
    mockIsTauriAvailable.mockReturnValue(true);
    window.prompt = vi.fn((message?: string | undefined) => {
      if (message?.includes("Choose start mode")) return "2";
      return "32456";
    });
    window.confirm = vi.fn(() => true);
    mockKubectlJson.mockImplementation((command: string) => {
      if (command.includes("get namespaces")) {
        return Promise.resolve({ items: [{ metadata: { name: "default" } }] });
      }
      return Promise.resolve({ items: [] });
    });
  });

  it("starts a port forward from form", async () => {
    mockStartPortForward.mockResolvedValue({ success: true });

    const { getByPlaceholderText, getByRole, queryByText } = render(PortForwardingPanel, {
      props: {
        data: {
          title: "Port Forwarding - Cluster: minikube",
          slug: "cluster-a",
          workload: "portforwarding",
          sort_field: null,
        },
      },
    });

    const resourceInput = getByPlaceholderText("svc/my-service") as HTMLInputElement;
    resourceInput.value = "svc/api";
    await fireEvent.input(resourceInput);
    const localPortInput = getByPlaceholderText("8080") as HTMLInputElement;
    localPortInput.value = "32456";
    await fireEvent.input(localPortInput);

    await fireEvent.click(getByRole("button", { name: "Start" }));

    expect(mockStartPortForward).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: "cluster-a",
        namespace: "default",
        resource: "svc/api",
        localPort: 32456,
        remotePort: 80,
      }),
    );
    expect(mockOpenInAppUrl).toHaveBeenCalledWith("http://127.0.0.1:32456");
    expect(mockToastSuccess).toHaveBeenCalledWith("Port-forward started: default svc/api 32456:80");
    expect(queryByText(/Port-forward started/i)).not.toBeInTheDocument();
  });

  it("renders and stops active forwards", async () => {
    let stopPromiseResolve!: () => void;
    mockStopPortForward.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          stopPromiseResolve = resolve;
        }),
    );

    mockPortForwardState.set({
      "cluster-a:default:svc/api:8080:80": {
        command: {} as never,
        child: {} as never,
        isRunning: true,
        localPort: 8080,
        remotePort: 80,
        namespace: "default",
        resource: "svc/api",
        clusterId: "cluster-a",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        lastMessage: "Forwarding from 127.0.0.1:8080",
        lastError: null,
        closedAt: null,
      },
    });

    const { getByText, getAllByRole, findByRole } = render(PortForwardingPanel, {
      props: {
        data: {
          title: "Port Forwarding - Cluster: minikube",
          slug: "cluster-a",
          workload: "portforwarding",
          sort_field: null,
        },
      },
    });

    expect(getByText("svc/api")).toBeInTheDocument();
    await fireEvent.click(getAllByRole("button", { name: "Stop" })[0]);
    expect(mockStopPortForward).toHaveBeenCalledWith("cluster-a:default:svc/api:8080:80");
    expect(await findByRole("button", { name: "Stopping..." })).toBeDisabled();

    stopPromiseResolve();
    await waitFor(() => {
      expect(() => getAllByRole("button", { name: "Stop" })).not.toThrow();
    });
  });

  it("does not stop forward when confirmation is rejected", async () => {
    mockPortForwardState.set({
      "cluster-a:default:svc/api:8080:80": {
        command: {} as never,
        child: {} as never,
        isRunning: true,
        localPort: 8080,
        remotePort: 80,
        namespace: "default",
        resource: "svc/api",
        clusterId: "cluster-a",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        lastMessage: "Forwarding from 127.0.0.1:8080",
        lastError: null,
        closedAt: null,
      },
    });
    window.confirm = vi.fn(() => false);

    const { getAllByRole } = render(PortForwardingPanel, {
      props: {
        data: {
          title: "Port Forwarding - Cluster: minikube",
          slug: "cluster-a",
          workload: "portforwarding",
          sort_field: null,
        },
      },
    });

    await fireEvent.click(getAllByRole("button", { name: "Stop" })[0]);
    expect(mockStopPortForward).not.toHaveBeenCalled();
  });

  it("applies detected resource and port from dropdown", async () => {
    mockKubectlJson.mockImplementation((command: string) => {
      if (command.includes("get namespaces")) {
        return Promise.resolve({ items: [{ metadata: { name: "default" } }] });
      }
      if (command.includes("get services")) {
        return Promise.resolve({
          items: [{ metadata: { name: "api" }, spec: { ports: [{ port: 9000 }] } }],
        });
      }
      return Promise.resolve({ items: [] });
    });

    const { findByText, getAllByRole, getByPlaceholderText } = render(PortForwardingPanel, {
      props: {
        data: {
          title: "Port Forwarding - Cluster: minikube",
          slug: "cluster-a",
          workload: "portforwarding",
          sort_field: null,
        },
      },
    });

    await findByText("Service: api (9000)");
    await fireEvent.change(getAllByRole("combobox")[1], { target: { value: "svc/api" } });

    expect((getByPlaceholderText("svc/my-service") as HTMLInputElement).value).toBe("svc/api");
    expect((getByPlaceholderText("80") as HTMLInputElement).value).toBe("9000");
  });

  it("opens external URL for pod forward", async () => {
    mockPortForwardState.set({
      "cluster-a:default:pod/api-0:8080:8080": {
        command: {} as never,
        child: {} as never,
        isRunning: true,
        localPort: 8080,
        remotePort: 8080,
        namespace: "default",
        resource: "pod/api-0",
        clusterId: "cluster-a",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        lastMessage: "Forwarding from 127.0.0.1:8080",
        lastError: null,
        closedAt: null,
      },
    });

    const { getAllByRole } = render(PortForwardingPanel, {
      props: {
        data: {
          title: "Port Forwarding - Cluster: minikube",
          slug: "cluster-a",
          workload: "portforwarding",
          sort_field: null,
        },
      },
    });

    await fireEvent.click(getAllByRole("button", { name: "Open external" })[0]);
    expect(mockOpenExternalUrl).toHaveBeenCalledWith("http://127.0.0.1:8080");
  });

  it("opens web preview inside app from active forwards row", async () => {
    mockPortForwardState.set({
      "cluster-a:default:svc/argocd-server:8080:8080": {
        command: {} as never,
        child: {} as never,
        isRunning: true,
        localPort: 8080,
        remotePort: 8080,
        namespace: "default",
        resource: "svc/argocd-server",
        clusterId: "cluster-a",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        lastMessage: "Forwarding from 127.0.0.1:8080",
        lastError: null,
        closedAt: null,
      },
    });

    render(PortForwardingPanel, {
      props: {
        data: {
          title: "Port Forwarding - Cluster: minikube",
          slug: "cluster-a",
          workload: "portforwarding",
          sort_field: null,
        },
      },
    });

    const openWebButtons = document.querySelectorAll("button");
    const openWebAction = Array.from(openWebButtons).find(
      (button) => button.textContent?.trim() === "Open Web",
    );
    expect(openWebAction).toBeTruthy();
    await fireEvent.click(openWebAction as HTMLButtonElement);

    expect(mockOpenInAppUrl).toHaveBeenCalledWith("http://127.0.0.1:8080");
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("e2e flow: start -> open internal web -> stop after confirmation", async () => {
    mockStartPortForward.mockResolvedValue({ success: true });

    const { getByPlaceholderText, getByRole, getAllByRole } = render(PortForwardingPanel, {
      props: {
        data: {
          title: "Port Forwarding - Cluster: minikube",
          slug: "cluster-a",
          workload: "portforwarding",
          sort_field: null,
        },
      },
    });

    const resourceInput = getByPlaceholderText("svc/my-service") as HTMLInputElement;
    resourceInput.value = "svc/app";
    await fireEvent.input(resourceInput);
    const localPortInput = getByPlaceholderText("8080") as HTMLInputElement;
    localPortInput.value = "32500";
    await fireEvent.input(localPortInput);
    await fireEvent.click(getByRole("button", { name: "Start" }));

    expect(mockStartPortForward).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: "cluster-a",
        namespace: "default",
        resource: "svc/app",
        localPort: 32500,
        remotePort: 80,
      }),
    );
    expect(mockOpenInAppUrl).toHaveBeenCalledWith("http://127.0.0.1:32500");

    mockPortForwardState.set({
      "cluster-a:default:svc/app:32500:80": {
        command: {} as never,
        child: {} as never,
        isRunning: true,
        localPort: 32500,
        remotePort: 80,
        namespace: "default",
        resource: "svc/app",
        clusterId: "cluster-a",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        lastMessage: "Forwarding from 127.0.0.1:32500",
        lastError: null,
        closedAt: null,
      },
    });

    await waitFor(() => {
      expect(getAllByRole("button", { name: "Open Web" })).toHaveLength(1);
    });
    await fireEvent.click(getAllByRole("button", { name: "Open Web" })[0]);
    expect(mockOpenInAppUrl).toHaveBeenLastCalledWith("http://127.0.0.1:32500");

    window.confirm = vi.fn(() => false);
    await fireEvent.click(getAllByRole("button", { name: "Stop" })[0]);
    expect(mockStopPortForward).not.toHaveBeenCalled();

    window.confirm = vi.fn(() => true);
    await fireEvent.click(getAllByRole("button", { name: "Stop" })[0]);
    expect(mockStopPortForward).toHaveBeenCalledWith("cluster-a:default:svc/app:32500:80");
  });

  it("restarts existing target on new local port after confirmation", async () => {
    mockStartPortForward.mockResolvedValue({ success: true });
    mockPortForwardState.set({
      "cluster-a:default:svc/app:31000:80": {
        command: {} as never,
        child: {} as never,
        isRunning: true,
        localPort: 31000,
        remotePort: 80,
        namespace: "default",
        resource: "svc/app",
        clusterId: "cluster-a",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        lastMessage: "Forwarding",
        lastError: null,
        closedAt: null,
      },
    });
    window.confirm = vi.fn(() => true);

    const { getByPlaceholderText, getByRole } = render(PortForwardingPanel, {
      props: {
        data: {
          title: "Port Forwarding - Cluster: minikube",
          slug: "cluster-a",
          workload: "portforwarding",
          sort_field: null,
        },
      },
    });

    const resourceInput = getByPlaceholderText("svc/my-service") as HTMLInputElement;
    resourceInput.value = "svc/app";
    await fireEvent.input(resourceInput);
    const localPortInput = getByPlaceholderText("8080") as HTMLInputElement;
    localPortInput.value = "32000";
    await fireEvent.input(localPortInput);

    await fireEvent.click(getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(mockStopPortForward).toHaveBeenCalledWith("cluster-a:default:svc/app:31000:80");
      expect(mockStartPortForward).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "svc/app",
          localPort: 32000,
          remotePort: 80,
        }),
      );
    });
  });

  it("does not start new forward when stopping previous one fails", async () => {
    mockStartPortForward.mockResolvedValue({ success: true });
    mockStopPortForward.mockRejectedValue(new Error("stop failed"));
    mockPortForwardState.set({
      "cluster-a:default:svc/app:31000:80": {
        command: {} as never,
        child: {} as never,
        isRunning: true,
        localPort: 31000,
        remotePort: 80,
        namespace: "default",
        resource: "svc/app",
        clusterId: "cluster-a",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now(),
        lastMessage: "Forwarding",
        lastError: null,
        closedAt: null,
      },
    });
    window.confirm = vi.fn(() => true);

    const { getByPlaceholderText, getByRole, getByText } = render(PortForwardingPanel, {
      props: {
        data: {
          title: "Port Forwarding - Cluster: minikube",
          slug: "cluster-a",
          workload: "portforwarding",
          sort_field: null,
        },
      },
    });

    const resourceInput = getByPlaceholderText("svc/my-service") as HTMLInputElement;
    resourceInput.value = "svc/app";
    await fireEvent.input(resourceInput);
    const localPortInput = getByPlaceholderText("8080") as HTMLInputElement;
    localPortInput.value = "32000";
    await fireEvent.input(localPortInput);

    await fireEvent.click(getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(mockStopPortForward).toHaveBeenCalledWith("cluster-a:default:svc/app:31000:80");
      expect(mockStartPortForward).not.toHaveBeenCalled();
      expect(getByText("stop failed")).toBeInTheDocument();
    });
  });

  it("allows dismissing inline error notice", async () => {
    const { getByRole, queryByText } = render(PortForwardingPanel, {
      props: {
        data: {
          title: "Port Forwarding - Cluster: minikube",
          slug: "cluster-a",
          workload: "portforwarding",
          sort_field: null,
        },
      },
    });

    await fireEvent.click(getByRole("button", { name: "Start" }));
    expect(
      queryByText("Resource must be in format kind/name, for example svc/my-service."),
    ).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Dismiss notification" }));
    expect(
      queryByText("Resource must be in format kind/name, for example svc/my-service."),
    ).not.toBeInTheDocument();
  });

  it("shows desktop-runtime requirement when tauri is unavailable", async () => {
    mockIsTauriAvailable.mockReturnValue(false);

    const { getByPlaceholderText, getByRole, getByText } = render(PortForwardingPanel, {
      props: {
        data: {
          title: "Port Forwarding - Cluster: minikube",
          slug: "cluster-a",
          workload: "portforwarding",
          sort_field: null,
        },
      },
    });

    const resourceInput = getByPlaceholderText("svc/my-service") as HTMLInputElement;
    resourceInput.value = "svc/api";
    await fireEvent.input(resourceInput);
    const localPortInput = getByPlaceholderText("8080") as HTMLInputElement;
    localPortInput.value = "32456";
    await fireEvent.input(localPortInput);

    await fireEvent.click(getByRole("button", { name: "Start" }));

    expect(mockStartPortForward).not.toHaveBeenCalled();
    expect(
      getByText("Port-forwarding is available only in the desktop runtime."),
    ).toBeInTheDocument();
  });
});
