import { describe, expect, it } from "vitest";
import {
  HMR_ERROR_PATTERNS,
  HMR_URL_PATTERNS,
  matchesHmrError,
  matchesHmrUrl,
} from "./sentry-filters";

describe("HMR_ERROR_PATTERNS", () => {
  it("catches real Vite module-script failures", () => {
    expect(matchesHmrError("TypeError: Importing a module script failed.")).toBe(true);
    expect(matchesHmrError("Importing a module script failed.")).toBe(true);
  });

  it("catches module.default undefined errors (Safari wording)", () => {
    expect(
      matchesHmrError("TypeError: undefined is not an object (evaluating 'module.default')"),
    ).toBe(true);
  });

  it("catches module.default undefined errors (Chrome wording)", () => {
    expect(
      matchesHmrError("TypeError: Cannot read properties of undefined (reading 'default')"),
    ).toBe(true);
  });

  it("does NOT catch generic ReferenceError - Safari emits the same wording for real prod bugs", () => {
    // Prod visibility must survive: the error-message filter stays narrow.
    // HMR-originating ReferenceErrors are dropped via denyUrls (stack origin).
    expect(matchesHmrError("ReferenceError: Can't find variable: inferEnv")).toBe(false);
    expect(matchesHmrError("ReferenceError: Can't find variable: fetchData")).toBe(false);
  });

  it("catches Svelte lifecycle getter errors during HMR swap", () => {
    expect(
      matchesHmrError(
        "TypeError: undefined is not an object (evaluating 'first_child_getter.call')",
      ),
    ).toBe(true);
    expect(
      matchesHmrError(
        "TypeError: undefined is not an object (evaluating 'next_sibling_getter.call')",
      ),
    ).toBe(true);
  });

  it("does NOT catch application-level errors we want to see", () => {
    expect(matchesHmrError("TypeError: Cannot read properties of null (reading 'name')")).toBe(
      false,
    );
    expect(matchesHmrError("Error: Cluster health check failed")).toBe(false);
    expect(matchesHmrError("kubectl: connection refused")).toBe(false);
  });

  it("handles undefined input", () => {
    expect(matchesHmrError(undefined)).toBe(false);
    expect(matchesHmrError("")).toBe(false);
  });

  it("every pattern is a RegExp with a description", () => {
    for (const p of HMR_ERROR_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
    expect(HMR_ERROR_PATTERNS.length).toBeGreaterThanOrEqual(3);
  });
});

describe("HMR_URL_PATTERNS", () => {
  it("catches Vite HMR client URLs", () => {
    expect(matchesHmrUrl("http://localhost:1420/@vite/client")).toBe(true);
    expect(matchesHmrUrl("http://localhost:1420/node_modules/.vite/deps/chunk-XYZ.js")).toBe(true);
  });

  it("catches the Vite HMR cache-busting timestamp query", () => {
    expect(matchesHmrUrl("http://localhost:1420/src/foo.svelte?t=1729390000000")).toBe(true);
  });

  it("does NOT catch regular app URLs", () => {
    expect(matchesHmrUrl("http://localhost:1420/src/lib/pages/cluster-manager/ui/foo.svelte")).toBe(
      false,
    );
    expect(matchesHmrUrl("https://prod.example.com/bundle.js")).toBe(false);
  });

  it("handles undefined input", () => {
    expect(matchesHmrUrl(undefined)).toBe(false);
    expect(matchesHmrUrl("")).toBe(false);
  });

  it("every pattern is a RegExp", () => {
    for (const p of HMR_URL_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });
});
