import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn());
vi.mock("svelte-sonner", () => ({ toast }));
const loadResourceYaml = vi.hoisted(() => vi.fn());
const applyResourceYaml = vi.hoisted(() => vi.fn());
vi.mock("./apply-resource-yaml", async (original) => ({
  ...(await original<typeof import("./apply-resource-yaml")>()),
  loadResourceYaml,
  applyResourceYaml,
}));
const confirmAction = vi.hoisted(() => vi.fn(async () => false));
vi.mock("$shared/lib/confirm-action", () => ({ confirmAction }));

import ResourceYamlTabs from "./resource-yaml-tabs.svelte";

const CRD_YAML = "apiVersion: apiextensions.k8s.io/v1\nkind: CustomResourceDefinition\n";
const request = (token: number) => ({
  token,
  name: "widgets.example.com",
  resource: "customresourcedefinitions",
  namespaceScoped: false,
  title: "CRD",
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ResourceYamlTabs", () => {
  it("opens a CRD as an editor tab in a workbench, not a side panel", async () => {
    loadResourceYaml.mockResolvedValue(CRD_YAML);
    render(ResourceYamlTabs, {
      props: { clusterId: "c1", request: request(1), onMessage: vi.fn(), onError: vi.fn() },
    });
    await waitFor(() => expect(loadResourceYaml).toHaveBeenCalledOnce());
    expect(loadResourceYaml.mock.calls[0][1]).toMatchObject({
      resource: "customresourcedefinitions",
      name: "widgets.example.com",
    });
    expect(await screen.findByTestId("resource-yaml-tabs")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close widgets.example.com tab" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Apply/ })).toBeInTheDocument();
  });

  it("re-opens the same tab for a repeated request instead of adding one", async () => {
    loadResourceYaml.mockResolvedValue(CRD_YAML);
    const { rerender } = render(ResourceYamlTabs, {
      props: { clusterId: "c1", request: request(1), onMessage: vi.fn(), onError: vi.fn() },
    });
    await waitFor(() => expect(loadResourceYaml).toHaveBeenCalledOnce());
    await rerender({ request: request(2) });
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Close widgets.example.com tab" })).toHaveLength(
        1,
      ),
    );
    expect(loadResourceYaml).toHaveBeenCalledOnce();
  });

  it("closes a clean tab at once, without asking", async () => {
    loadResourceYaml.mockResolvedValue(CRD_YAML);
    render(ResourceYamlTabs, {
      props: { clusterId: "c1", request: request(1), onMessage: vi.fn(), onError: vi.fn() },
    });
    await waitFor(() => expect(loadResourceYaml).toHaveBeenCalledOnce());
    await fireEvent.click(screen.getByRole("button", { name: "Close widgets.example.com tab" }));
    expect(confirmAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("resource-yaml-tabs")).toBeNull());
  });
});
