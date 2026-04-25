import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it } from "vitest";
import WorkloadsMenu from "./workloads.svelte";

const STORAGE_KEY = "dashboard:cluster-menu:sections:v1";

describe("workloads menu", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("keeps sections collapsed by default and expands on click", async () => {
    const { getByRole, queryByRole } = render(WorkloadsMenu, {
      props: { searchParams: {}, collapsed: false },
    });

    expect(getByRole("link", { name: "Global Triage" })).toBeInTheDocument();
    expect(queryByRole("link", { name: "Pods" })).not.toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Workloads" }));

    expect(getByRole("link", { name: "Pods" })).toBeInTheDocument();
  });

  it("persists section open state in localStorage", async () => {
    const first = render(WorkloadsMenu, {
      props: { searchParams: {}, collapsed: false },
    });

    await fireEvent.click(first.getByRole("button", { name: "Cluster Ops" }));
    expect(first.getByRole("link", { name: "API Deprecation Scan" })).toBeInTheDocument();
    expect(first.getByRole("link", { name: "Helm Releases" })).toBeInTheDocument();
    first.unmount();

    const second = render(WorkloadsMenu, {
      props: { searchParams: {}, collapsed: false },
    });

    await waitFor(() => {
      expect(second.getByRole("link", { name: "API Deprecation Scan" })).toBeInTheDocument();
    });
  });

  it("restores expanded behavior after collapsing sidebar", async () => {
    const { getByRole, queryByRole, rerender } = render(WorkloadsMenu, {
      props: { searchParams: {}, collapsed: false },
    });

    await fireEvent.click(getByRole("button", { name: "Security & Compliance" }));
    expect(getByRole("link", { name: "Trivy" })).toBeInTheDocument();

    await rerender({ searchParams: {}, collapsed: true });
    expect(queryByRole("button", { name: "Security & Compliance" })).not.toBeInTheDocument();

    await rerender({ searchParams: {}, collapsed: false });
    expect(getByRole("button", { name: "Security & Compliance" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Trivy" })).toBeInTheDocument();
  });

  it("allows collapsing active Cluster Ops section without immediate auto-reopen", async () => {
    const { getByRole, queryByRole } = render(WorkloadsMenu, {
      props: { searchParams: { workload: "versionaudit" }, collapsed: false },
    });

    expect(getByRole("link", { name: "Version Audit" })).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Cluster Ops" }));

    expect(queryByRole("link", { name: "Version Audit" })).not.toBeInTheDocument();
  });

  it("renders Network and Storage sections with expected entries", async () => {
    const { getByRole } = render(WorkloadsMenu, {
      props: { searchParams: {}, collapsed: false },
    });

    await fireEvent.click(getByRole("button", { name: "Network" }));
    expect(getByRole("link", { name: "Services" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Endpoints" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Ingresses" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Ingress Classes" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Gateway Classes" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Gateways" })).toBeInTheDocument();
    expect(getByRole("link", { name: "HTTP Routes" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Port Forwarding" })).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Storage" }));
    expect(getByRole("link", { name: "Persistent Volumes" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Storage Classes" })).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Access Control" }));
    expect(getByRole("link", { name: "Service Accounts" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Cluster Role Bindings" })).toBeInTheDocument();
    expect(getByRole("link", { name: "Access Reviews" })).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Custom resources" }));
    expect(getByRole("link", { name: "Custom Resource Definitions" })).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Namespace" }));
    expect(getByRole("link", { name: "Namespaces" })).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Workloads" }));
    expect(getByRole("link", { name: "Replication Controllers" })).toBeInTheDocument();
  }, 30000);

  it("adds standalone navigation hint tooltip on left-menu links", async () => {
    const { getByRole } = render(WorkloadsMenu, {
      props: { searchParams: {}, collapsed: false },
    });

    await fireEvent.click(getByRole("button", { name: "Workloads" }));
    const podsLink = getByRole("link", { name: "Pods" });
    expect(podsLink).toHaveAttribute(
      "title",
      expect.stringContaining("Opens as a standalone page."),
    );
  });
});
