import { describe, expect, it, vi } from "vitest";
import {
  addView,
  removeView,
  updateView,
  setDefaultView,
  getDefaultView,
  applyViewFilters,
  type SavedView,
} from "./saved-views";

vi.stubGlobal("crypto", {
  randomUUID: vi.fn().mockReturnValue("view-uuid-1"),
  getRandomValues: <T extends ArrayBufferView>(values: T) => values,
  subtle: {} as SubtleCrypto,
} as unknown as Crypto);

const clusters = [
  { uuid: "c1", name: "prod-us", provider: "AWS EKS", env: "prod", tags: ["aws"], offline: false },
  { uuid: "c2", name: "staging-eu", provider: "GKE", env: "stage", tags: ["gke"], offline: false },
  {
    uuid: "c3",
    name: "dev-local",
    provider: "Minikube",
    env: "dev",
    tags: ["local"],
    offline: true,
  },
  {
    uuid: "c4",
    name: "prod-eu",
    provider: "AWS EKS",
    env: "prod",
    tags: ["aws", "eu"],
    offline: false,
  },
];

describe("saved-views", () => {
  describe("CRUD operations", () => {
    it("adds a view", () => {
      const views = addView([], "My View", { envFilter: "prod" });
      expect(views).toHaveLength(1);
      expect(views[0]?.name).toBe("My View");
      expect(views[0]?.filters.envFilter).toBe("prod");
    });

    it("removes a view", () => {
      const views: SavedView[] = [
        { id: "v1", name: "A", filters: {} },
        { id: "v2", name: "B", filters: {} },
      ];
      const result = removeView(views, "v1");
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("B");
    });

    it("updates view name and filters", () => {
      const views: SavedView[] = [{ id: "v1", name: "Old", filters: { search: "test" } }];
      const result = updateView(views, "v1", { name: "New", filters: { search: "updated" } });
      expect(result[0]?.name).toBe("New");
      expect(result[0]?.filters.search).toBe("updated");
    });

    it("sets default view", () => {
      const views: SavedView[] = [
        { id: "v1", name: "A", filters: {} },
        { id: "v2", name: "B", filters: {} },
      ];
      const result = setDefaultView(views, "v2");
      expect(result[0]?.isDefault).toBe(false);
      expect(result[1]?.isDefault).toBe(true);
    });

    it("gets default view", () => {
      const views: SavedView[] = [
        { id: "v1", name: "A", filters: {}, isDefault: false },
        { id: "v2", name: "B", filters: {}, isDefault: true },
      ];
      expect(getDefaultView(views)?.id).toBe("v2");
    });
  });

  describe("applyViewFilters", () => {
    it("filters by search term", () => {
      const result = applyViewFilters(clusters, { search: "prod" });
      expect(result).toHaveLength(2);
    });

    it("filters by env", () => {
      const result = applyViewFilters(clusters, { envFilter: "prod" });
      expect(result).toHaveLength(2);
    });

    it("filters by provider", () => {
      const result = applyViewFilters(clusters, { providerFilter: "GKE" });
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("staging-eu");
    });

    it("filters by status online", () => {
      const result = applyViewFilters(clusters, { statusFilter: "online" });
      expect(result).toHaveLength(3);
    });

    it("filters by status offline", () => {
      const result = applyViewFilters(clusters, { statusFilter: "offline" });
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("dev-local");
    });

    it("filters by tag", () => {
      const result = applyViewFilters(clusters, { tagFilter: "eu" });
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("prod-eu");
    });

    it("filters by group membership", () => {
      const membership = { c1: "g1", c4: "g1" };
      const result = applyViewFilters(clusters, { groupId: "g1" }, membership);
      expect(result).toHaveLength(2);
    });

    it("combines multiple filters", () => {
      const result = applyViewFilters(clusters, {
        envFilter: "prod",
        providerFilter: "AWS EKS",
        statusFilter: "online",
      });
      expect(result).toHaveLength(2);
    });

    it("returns all with empty filters", () => {
      const result = applyViewFilters(clusters, {});
      expect(result).toHaveLength(4);
    });

    it("returns all when filters are 'all'", () => {
      const result = applyViewFilters(clusters, {
        envFilter: "all",
        providerFilter: "all",
        statusFilter: "all",
      });
      expect(result).toHaveLength(4);
    });
  });
});
