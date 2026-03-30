import { describe, expect, it } from "vitest";
import { load } from "../../routes/dashboard/clusters/[slug]/+page";

describe("clusters/[slug] page load", () => {
  it("keeps slug unchanged to avoid double-encoding cluster ids", () => {
    const result = load({
      params: {
        title: "",
        slug: "arn:aws:eks:us-east-1:123456789012:cluster/dev-cluster",
        workload: null,
        sort_field: null,
      },
      url: new URL("https://example.test/dashboard/clusters/dev?workload=overview"),
    });

    expect(result.slug).toBe("arn:aws:eks:us-east-1:123456789012:cluster/dev-cluster");
    expect(result.workload).toBe("overview");
  });
});
