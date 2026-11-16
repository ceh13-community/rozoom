import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  reportKubectlOutcome,
  resetClusterConnectivity,
  selectClusterConnectivity,
} from "$shared/model/cluster-connectivity";

const kubectlRawArgsFront = vi.fn();
vi.mock("./kubectl-proxy", () => ({
  kubectlRawArgsFront: (...args: unknown[]) => kubectlRawArgsFront(...args),
}));

const { checkClusterConnectivity, CONNECTIVITY_CHECK_TIMEOUT_MS } = await import(
  "./cluster-connectivity-check"
);

const NO_ROUTE =
  "Unable to connect to the server: dial tcp 192.168.49.2:8443: connect: no route to host";

// The real proxy reports every finished exec; the mock does the same.
function answer(result: { output: string; errors: string; code: number }) {
  return (_args: string[], options: { clusterId: string }) => {
    reportKubectlOutcome(options.clusterId, { code: result.code, stderr: result.errors });
    return Promise.resolve(result);
  };
}

describe("checkClusterConnectivity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetClusterConnectivity();
    kubectlRawArgsFront.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the server for its version and records it", async () => {
    kubectlRawArgsFront.mockImplementation(
      answer({ output: '{"gitVersion":"v1.31.0"}', errors: "", code: 0 }),
    );
    const entry = await checkClusterConnectivity("a");
    expect(kubectlRawArgsFront).toHaveBeenCalledWith(
      ["get", "--raw", "/version", "--request-timeout=5s"],
      expect.objectContaining({ clusterId: "a" }),
    );
    expect(entry).toMatchObject({ state: "online", lastKnownVersion: "v1.31.0", checking: false });
  });

  it("shows Checking while it runs and the reason when it fails", async () => {
    let finish: () => void = () => {};
    kubectlRawArgsFront.mockImplementation(
      (_args: string[], options: { clusterId: string }) =>
        new Promise((resolve) => {
          finish = () => {
            reportKubectlOutcome(options.clusterId, { code: 1, stderr: NO_ROUTE });
            resolve({ output: "", errors: NO_ROUTE, code: 1 });
          };
        }),
    );
    const check = checkClusterConnectivity("a");
    expect(get(selectClusterConnectivity("a")).checking).toBe(true);
    finish();
    const entry = await check;
    expect(entry).toMatchObject({
      state: "unreachable",
      reason: "No route to the cluster address",
      checking: false,
    });
  });

  it("joins a check that is already running instead of starting another", async () => {
    kubectlRawArgsFront.mockImplementation(answer({ output: "{}", errors: "", code: 0 }));
    const [first, second] = [checkClusterConnectivity("a"), checkClusterConnectivity("a")];
    expect(first).toBe(second);
    await first;
    expect(kubectlRawArgsFront).toHaveBeenCalledTimes(1);
  });

  it("gives up on a call that never returns and says the server did not answer", async () => {
    vi.useFakeTimers();
    kubectlRawArgsFront.mockImplementation(
      (_args: string[], options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const check = checkClusterConnectivity("a");
    await vi.advanceTimersByTimeAsync(CONNECTIVITY_CHECK_TIMEOUT_MS);
    const entry = await check;
    expect(entry).toMatchObject({
      state: "unreachable",
      reason: "No answer from the server",
      checking: false,
    });
    expect(entry.detail).toMatch(/^Gave up after 35 s/);
  });
});
