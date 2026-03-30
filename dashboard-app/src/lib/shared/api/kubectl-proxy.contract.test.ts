import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/shared/api/kubectl-proxy.ts"), "utf8");

describe("kubectl proxy request guard contract", () => {
  it("adds request timeout to read commands and throttles repeated error logs", () => {
    expect(source).toContain('const DEFAULT_READ_REQUEST_TIMEOUT = "--request-timeout=10s";');
    expect(source).toContain("const DEFAULT_KUBECTL_EXECUTION_BUDGET");
    expect(source).toContain("function withReadRequestTimeout(args: string[])");
    expect(source).toContain('if (args[0] !== "get") return args;');
    expect(source).toContain("if (isWatchCommand(args)) return args;");
    expect(source).toContain("async function runKubectlBudgeted<T>(");
    expect(source).toContain("export function setKubectlExecutionBudget");
    expect(source).toContain("const KUBECTL_ERROR_LOG_WINDOW_MS = 15_000;");
    expect(source).toContain("async function logKubectlErrorThrottled(message: string)");
    expect(source).toContain("return `kubectl command failed:");
    expect(source).toContain("await logKubectlErrorThrottled(buildKubectlFailureMessage(");
  });

  it("keeps browser invoke fallback out of the real Tauri runtime", () => {
    expect(source).toContain("getBrowserInvokeFallback");
    expect(source).toContain("isTauriAvailable");
    expect(source).toContain("Desktop kubectl is unavailable outside the Tauri runtime.");
    expect(source).toContain('invoke("rozoom:kubectl-proxy"');
    expect(source).toContain('const code = typeof result.code === "number" ? result.code : 0;');
    expect(source).toContain(
      'code !== 0 && typeof result.errors === "string" ? result.errors : ""',
    );
  });
});
