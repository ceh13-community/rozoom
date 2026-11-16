import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { ClusterConnectivity } from "$shared/model/cluster-connectivity";
import ConnectivityBadge from "./connectivity-badge.svelte";
import ClusterUnreachableBanner from "./cluster-unreachable-banner.svelte";

const NO_ROUTE =
  "Unable to connect to the server: dial tcp 192.168.49.2:8443: connect: no route to host";

function entry(patch: Partial<ClusterConnectivity>): ClusterConnectivity {
  return {
    state: "unknown",
    reason: null,
    detail: null,
    checking: false,
    lastContactAt: null,
    lastKnownVersion: null,
    checkedAt: null,
    ...patch,
  };
}

describe("ConnectivityBadge", () => {
  it("shows nothing before anything talked to the cluster", () => {
    render(ConnectivityBadge, { props: { connectivity: entry({}) } });
    expect(screen.queryByTestId("cluster-connectivity-badge")).toBeNull();
  });

  it.each([
    [{ state: "online" as const }, "online", "Online"],
    [{ state: "unreachable" as const, reason: "Connection refused" }, "unreachable", "Unreachable"],
    [{ state: "auth-expired" as const }, "auth-expired", "Auth expired"],
    [{ state: "unknown" as const, checking: true }, "checking", "Checking"],
    [{ state: "unreachable" as const, checking: true }, "checking", "Checking"],
  ])("shows %o as %s", (patch, kind, text) => {
    render(ConnectivityBadge, { props: { connectivity: entry(patch) } });
    const badge = screen.getByTestId("cluster-connectivity-badge");
    expect(badge.dataset.state).toBe(kind);
    expect(badge.textContent?.trim()).toBe(text);
  });

  it("does not flicker a live cluster to Checking during a background check", () => {
    render(ConnectivityBadge, {
      props: { connectivity: entry({ state: "online", checking: true }) },
    });
    expect(screen.getByTestId("cluster-connectivity-badge").dataset.state).toBe("online");
  });

  it("puts the reason and the last answer in the tooltip", () => {
    const lastContactAt = new Date().setHours(14, 2, 0, 0);
    render(ConnectivityBadge, {
      props: {
        connectivity: entry({ state: "unreachable", reason: "Connection refused", lastContactAt }),
      },
    });
    expect(screen.getByTestId("cluster-connectivity-badge").title).toBe(
      "Connection refused. Last answer: 14:02",
    );
  });
});

describe("ClusterUnreachableBanner", () => {
  it("says the cluster did not answer, why, and what to check", () => {
    render(ClusterUnreachableBanner, {
      props: {
        clusterName: "minikube",
        connectivity: entry({
          state: "unreachable",
          reason: "No route to the cluster address",
          detail: NO_ROUTE,
        }),
        mode: "disconnected",
        onRetry: vi.fn(),
      },
    });
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Cluster unreachable");
    expect(banner).toHaveTextContent("minikube did not answer, so there is no data to show.");
    expect(banner).toHaveTextContent("Reason: No route to the cluster address.");
    expect(banner).toHaveTextContent(
      "Check the server: address in your kubeconfig, then your VPN or network.",
    );
    // The raw error stays under Details.
    expect(banner).not.toHaveTextContent(NO_ROUTE);
  });

  it("shows the raw error only after Details", async () => {
    render(ClusterUnreachableBanner, {
      props: {
        clusterName: "minikube",
        connectivity: entry({ state: "unreachable", reason: "x", detail: NO_ROUTE }),
        mode: "disconnected",
        onRetry: vi.fn(),
      },
    });
    const details = screen.getByRole("button", { name: "Details" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    await fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(NO_ROUTE);
  });

  it("makes Retry the first button and disables it while checking", async () => {
    const onRetry = vi.fn();
    const view = render(ClusterUnreachableBanner, {
      props: {
        clusterName: "minikube",
        connectivity: entry({ state: "unreachable", reason: "x", detail: NO_ROUTE }),
        mode: "disconnected",
        onRetry,
      },
    });
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("Retry");
    await fireEvent.click(buttons[0]);
    expect(onRetry).toHaveBeenCalledTimes(1);

    await view.rerender({
      clusterName: "minikube",
      connectivity: entry({ state: "unreachable", reason: "x", detail: NO_ROUTE, checking: true }),
      mode: "disconnected",
      onRetry,
    });
    const retry = screen.getAllByRole("button")[0];
    expect(retry).toHaveTextContent("Checking");
    expect(retry).toBeDisabled();
  });

  it("tells the user to sign in again when the credentials were rejected", () => {
    render(ClusterUnreachableBanner, {
      props: {
        clusterName: "prod",
        connectivity: entry({ state: "auth-expired", reason: "Credentials expired or rejected" }),
        mode: "disconnected",
        onRetry: vi.fn(),
      },
    });
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Auth expired");
    expect(banner).toHaveTextContent(
      "The cluster rejected your credentials, so there is no data to show.",
    );
    expect(banner).toHaveTextContent("Sign in again in your terminal");
  });

  it("points at the certificate-authority entry for an untrusted certificate", () => {
    render(ClusterUnreachableBanner, {
      props: {
        clusterName: "prod",
        connectivity: entry({ state: "unreachable", reason: "Certificate not trusted" }),
        mode: "disconnected",
        onRetry: vi.fn(),
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Check the certificate-authority entry in your kubeconfig.",
    );
  });

  it("says which data is shown when rows from before the drop stay on screen", () => {
    render(ClusterUnreachableBanner, {
      props: {
        clusterName: "minikube",
        connectivity: entry({ state: "unreachable", reason: "Connection refused" }),
        mode: "disconnected",
        showingDataFrom: new Date().setHours(14, 2, 0, 0),
        onRetry: vi.fn(),
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Showing data from 14:02.");
  });

  it("is neutral while the cluster has not answered yet", () => {
    render(ClusterUnreachableBanner, {
      props: {
        clusterName: "minikube",
        connectivity: entry({ checking: true }),
        mode: "waiting",
        onRetry: vi.fn(),
      },
    });
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Still trying to reach the cluster");
    expect(banner).not.toHaveTextContent("Reason:");
  });
});
