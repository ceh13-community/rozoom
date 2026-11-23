import { describe, expect, it, vi } from "vitest";
import {
  PORT_FORWARD_LOG_LINES,
  appendForwardLog,
  describePortForwardState,
  formatUptime,
  isHandlingConnectionLine,
  testPortForwardUrl,
} from "./port-forward-status";

vi.mock("./tauri-runtime", () => ({ isTauriAvailable: () => false }));

const forward = (over: Partial<Parameters<typeof describePortForwardState>[0] & object> = {}) => ({
  isRunning: true,
  startedAt: 1_000,
  closedAt: null,
  lastMessage: "Forwarding from 127.0.0.1:30080 -> 80",
  lastError: null,
  connections: 3,
  ...over,
});

describe("port-forward status", () => {
  it("counts kubectl's connection lines and nothing else", () => {
    expect(isHandlingConnectionLine("Handling connection for 30080")).toBe(true);
    expect(isHandlingConnectionLine("Forwarding from 127.0.0.1:30080 -> 80")).toBe(false);
    expect(isHandlingConnectionLine("I1123 15:07:19.793300 1426131 envvar.go:195] ...")).toBe(
      false,
    );
  });

  it("keeps the newest lines with their time and drops blank ones", () => {
    const at = new Date(2026, 10, 23, 14, 5, 9).getTime();
    expect(appendForwardLog([], "Forwarding from 127.0.0.1:30080 -> 80", at)).toEqual([
      "14:05:09  Forwarding from 127.0.0.1:30080 -> 80",
    ]);
    expect(appendForwardLog(["a"], "   ", at)).toEqual(["a"]);
    let log: string[] = [];
    for (let i = 0; i < PORT_FORWARD_LOG_LINES + 5; i += 1)
      log = appendForwardLog(log, `line ${i}`, at);
    expect(log).toHaveLength(PORT_FORWARD_LOG_LINES);
    expect(log[0]).toContain("line 5");
    expect(log.at(-1)).toContain(`line ${PORT_FORWARD_LOG_LINES + 4}`);
  });

  it("formats an uptime the way a status line reads it", () => {
    expect(formatUptime(12_000)).toBe("12s");
    expect(formatUptime(185_000)).toBe("3m 05s");
    expect(formatUptime(3_720_000)).toBe("1h 02m");
    expect(formatUptime(99 * 3_600_000)).toBe("4d 03h");
    expect(formatUptime(-5)).toBe("0s");
  });

  it("names the state: starting, active, error, stopped, failed, not running", () => {
    expect(
      describePortForwardState(forward({ lastMessage: "Starting port-forward..." })),
    ).toMatchObject({
      state: "starting",
      label: "Starting",
    });
    expect(describePortForwardState(forward())).toMatchObject({
      state: "active",
      label: "Active",
      connections: 3,
      startedAt: 1_000,
    });
    expect(
      describePortForwardState(forward({ lastError: "error: lost connection to pod" })),
    ).toMatchObject({ state: "error", label: "Error", detail: "error: lost connection to pod" });
    expect(describePortForwardState(forward({ isRunning: false, closedAt: 2_000 }))).toMatchObject({
      state: "stopped",
      label: "Stopped",
      closedAt: 2_000,
    });
    expect(
      describePortForwardState(
        forward({ isRunning: false, lastError: "bind: address already in use" }),
      ),
    ).toMatchObject({ state: "error", label: "Failed" });
    expect(describePortForwardState(undefined)).toMatchObject({
      state: "stopped",
      label: "Not running",
      connections: 0,
    });
  });

  it("Test: a 2xx or 3xx answer is ok with its time, 4xx and 5xx keep their code", async () => {
    let clock = 100;
    const now = () => clock;
    const fetchImpl = vi.fn(async () => {
      clock += 12;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await testPortForwardUrl("http://127.0.0.1:30080", { fetchImpl, now })).toEqual({
      ok: true,
      status: 200,
      ms: 12,
      error: null,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:30080",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );

    const notFound = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    expect(
      await testPortForwardUrl("http://127.0.0.1:30080", { fetchImpl: notFound, now }),
    ).toMatchObject({
      ok: false,
      status: 404,
      error: "HTTP 404",
    });
  });

  it("Test: no answer within the timeout and a refused connection are failures with a reason", async () => {
    vi.useFakeTimers();
    try {
      const hang = ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })) as unknown as typeof fetch;
      const pending = testPortForwardUrl("http://127.0.0.1:30080", {
        fetchImpl: hang,
        timeoutMs: 2_000,
      });
      await vi.advanceTimersByTimeAsync(2_001);
      expect(await pending).toMatchObject({
        ok: false,
        status: null,
        error: "No answer within 2 s",
      });
    } finally {
      vi.useRealTimers();
    }

    const refused = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    expect(
      await testPortForwardUrl("http://127.0.0.1:30080", { fetchImpl: refused }),
    ).toMatchObject({
      ok: false,
      status: null,
      error: "connection refused",
    });
  });
});
