import { beforeEach, describe, expect, it } from "vitest";
import { deleteSavedView, listSavedViews, upsertSavedView } from "./saved-views-store";

describe("saved-views-store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("upserts and lists views by recency", () => {
    upsertSavedView({
      id: "pods-default",
      name: "Pods default",
      workload: "pods",
      clusterId: "cluster-a",
      query: "ns:default",
      columns: ["name", "status"],
      sortBy: "age",
      sortDirection: "desc",
    });
    upsertSavedView({
      id: "pods-prod",
      name: "Pods prod",
      workload: "pods",
      clusterId: "cluster-a",
      query: "ns:prod",
      columns: ["name", "status"],
      sortBy: "age",
      sortDirection: "desc",
    });

    const all = listSavedViews();
    expect(all.length).toBe(2);
    expect(all.map((item) => item.id).sort()).toEqual(["pods-default", "pods-prod"]);
  });

  it("deletes saved view", () => {
    upsertSavedView({
      id: "x",
      name: "X",
      workload: "pods",
      clusterId: "cluster-a",
      query: "",
      columns: ["name"],
      sortBy: "name",
      sortDirection: "asc",
    });
    deleteSavedView("x");
    expect(listSavedViews()).toEqual([]);
  });
});
