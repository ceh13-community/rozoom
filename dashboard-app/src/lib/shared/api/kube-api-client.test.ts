import { beforeEach, describe, expect, it, vi } from "vitest";

const acquireMock = vi.fn();
const releaseMock = vi.fn();

const tauriFetchMock = vi.fn();
const isTauriAvailableMock = vi.fn(() => false);

vi.mock("./kube-api-proxy", () => ({
  acquireKubeApiProxy: acquireMock,
  releaseKubeApiProxy: releaseMock,
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: tauriFetchMock,
}));

vi.mock("$shared/lib/tauri-runtime", () => ({
  isTauriAvailable: isTauriAvailableMock,
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
    acquireMock.mockResolvedValue({ clusterId: "cluster-a", baseUrl: "http://127.0.0.1:39123" });
    releaseMock.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());
    tauriFetchMock.mockReset();
    isTauriAvailableMock.mockReturnValue(false);
  });

  it("sends desktop requests to the kubectl proxy through the HTTP plugin, not the webview", async () => {
    isTauriAvailableMock.mockReturnValue(true);
    tauriFetchMock.mockResolvedValueOnce(
      makeJsonResponse({ metadata: { resourceVersion: "7" }, items: [] }),
    );
    tauriFetchMock.mockResolvedValueOnce(
      new Response(
        '{"type":"ADDED","object":{"metadata":{"name":"svc","resourceVersion":"8"}}}\n',
        {
          status: 200,
        },
      ),
    );

    const { listKubeResource, watchKubeResource } = await import("./kube-api-client");
    await listKubeResource({ clusterId: "cluster-a", path: "/api/v1/services" });
    const onEvent = vi.fn();
    const result = await watchKubeResource({
      clusterId: "cluster-a",
      path: "/api/v1/services",
      resourceVersion: "7",
      onEvent,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(tauriFetchMock).toHaveBeenCalledTimes(2);
    expect(tauriFetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:39123/api/v1/services");
    expect(tauriFetchMock.mock.calls[1]?.[0]).toContain("/api/v1/services?watch=1");
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ expired: false, resourceVersion: "8" });
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
    expect(releaseMock).toHaveBeenCalledWith({
      clusterId: "cluster-a",
      baseUrl: "http://127.0.0.1:39123",
    });
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
    // The API server rejects resourceVersionMatch on a watch without
    // sendInitialEvents (422), so a plain watch must not send it.
    const watchUrl = new URL(String(vi.mocked(fetch).mock.calls[0]?.[0]));
    expect(watchUrl.searchParams.get("resourceVersion")).toBe("55");
    expect(watchUrl.searchParams.has("resourceVersionMatch")).toBe(false);
    expect(watchUrl.searchParams.has("sendInitialEvents")).toBe(false);
    expect(releaseMock).toHaveBeenCalledWith({
      clusterId: "cluster-a",
      baseUrl: "http://127.0.0.1:39123",
    });
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
      onEvent: vi.fn(),
    });

    expect(result).toEqual({ expired: true, resourceVersion: "55" });
  });

  it("links each request to the caller's signal and unlinks it when done", async () => {
    isTauriAvailableMock.mockReturnValue(true);
    tauriFetchMock
      .mockResolvedValueOnce(makeJsonResponse({ metadata: { resourceVersion: "7" }, items: [] }))
      .mockResolvedValueOnce(
        new Response(
          '{"type":"ADDED","object":{"metadata":{"name":"a","resourceVersion":"8"}}}\n',
          {
            status: 200,
          },
        ),
      );
    const session = new AbortController();
    const added = vi.spyOn(session.signal, "addEventListener");
    const removed = vi.spyOn(session.signal, "removeEventListener");

    const { listKubeResource, watchKubeResource } = await import("./kube-api-client");
    await listKubeResource({
      clusterId: "cluster-a",
      path: "/api/v1/pods",
      signal: session.signal,
    });
    await watchKubeResource({
      clusterId: "cluster-a",
      path: "/api/v1/pods",
      resourceVersion: "7",
      signal: session.signal,
      onEvent: vi.fn(),
    });

    // The plugin gets a per-request signal, never the long-lived session signal.
    for (const call of tauriFetchMock.mock.calls) {
      expect((call[1] as RequestInit).signal).not.toBe(session.signal);
    }
    expect(added).toHaveBeenCalledTimes(2);
    expect(removed).toHaveBeenCalledTimes(2);
  });

  it("aborts the request when the caller's signal aborts", async () => {
    isTauriAvailableMock.mockReturnValue(true);
    let requestSignal: AbortSignal | undefined;
    tauriFetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      requestSignal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const session = new AbortController();

    const { listKubeResource } = await import("./kube-api-client");
    void listKubeResource({ clusterId: "cluster-a", path: "/api/v1/pods", signal: session.signal });
    await vi.waitFor(() => {
      expect(requestSignal).toBeDefined();
    });
    session.abort();

    expect(requestSignal?.aborted).toBe(true);
  });
});
