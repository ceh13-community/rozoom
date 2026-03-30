import { beforeEach, describe, expect, it, vi } from "vitest";

const acquireMock = vi.fn();
const releaseMock = vi.fn();

vi.mock("./kube-api-proxy", () => ({
  acquireKubeApiProxy: acquireMock,
  releaseKubeApiProxy: releaseMock,
}));

function makeJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("kube-api-client", () => {
  beforeEach(() => {
    vi.resetModules();
    acquireMock.mockReset();
    releaseMock.mockReset();
    acquireMock.mockResolvedValue("http://127.0.0.1:39123");
    releaseMock.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("lists resources and returns the list resourceVersion", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeJsonResponse({
        metadata: { resourceVersion: "55" },
        items: [{ metadata: { name: "demo" } }],
      }),
    );

    const { listKubeResource } = await import("./kube-api-client");
    const result = await listKubeResource<{ metadata?: { name?: string } }>({
      clusterId: "cluster-a",
      path: "/api/v1/pods",
    });

    expect(result).toEqual({
      items: [{ metadata: { name: "demo" } }],
      resourceVersion: "55",
    });
    expect(releaseMock).toHaveBeenCalledWith("cluster-a");
  });

  it("streams watch events and returns the latest resourceVersion", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify({
              type: "ADDED",
              object: { metadata: { name: "demo", resourceVersion: "56" } },
            })}\n${JSON.stringify({
              type: "BOOKMARK",
              object: { metadata: { resourceVersion: "57" } },
            })}\n`,
          ),
        );
        controller.close();
      },
    });

    vi.mocked(fetch).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const events: Array<{ type: string }> = [];
    const { watchKubeResource } = await import("./kube-api-client");
    const result = await watchKubeResource({
      clusterId: "cluster-a",
      path: "/api/v1/pods",
      resourceVersion: "55",
      onEvent: (event) => {
        events.push({ type: event.type });
      },
    });

    expect(events).toEqual([{ type: "ADDED" }, { type: "BOOKMARK" }]);
    expect(result).toEqual({ expired: false, resourceVersion: "57" });
    expect(releaseMock).toHaveBeenCalledWith("cluster-a");
  });

  it("treats 410 error watch events as expired relist signals", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `${JSON.stringify({
              type: "ERROR",
              object: { code: 410, metadata: { resourceVersion: "58" } },
            })}\n`,
          ),
        );
        controller.close();
      },
    });

    vi.mocked(fetch).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { watchKubeResource } = await import("./kube-api-client");
    const result = await watchKubeResource({
      clusterId: "cluster-a",
      path: "/api/v1/pods",
      resourceVersion: "55",
      sendInitialEvents: true,
      onEvent: vi.fn(),
    });

    expect(result).toEqual({ expired: true, resourceVersion: "55" });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain("sendInitialEvents=true");
  });
});
