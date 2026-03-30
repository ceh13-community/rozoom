import { describe, expect, it } from "vitest";
import { decodeWorkbenchRouteState, encodeWorkbenchRouteState } from "./workbench-route-state";

describe("workbench-route-state", () => {
  it("encodes and decodes route state", () => {
    const encoded = encodeWorkbenchRouteState({
      resource: "pod/api-123",
      namespace: "prod",
      tab: "yaml",
      pane: 2,
      compare: "pod/api-124",
      query: "status!=running",
    });

    expect(decodeWorkbenchRouteState(encoded)).toEqual({
      resource: "pod/api-123",
      namespace: "prod",
      tab: "yaml",
      pane: 2,
      compare: "pod/api-124",
      query: "status!=running",
    });
  });
});
