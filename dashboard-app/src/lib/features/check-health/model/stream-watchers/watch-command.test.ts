import { describe, expect, it } from "vitest";
import { buildKubectlWatchCommand, DEFAULT_WATCH_REQUEST_TIMEOUT } from "./watch-command";

describe("watch-command", () => {
  it("adds watch flags and bounded request timeout to base commands", () => {
    expect(buildKubectlWatchCommand("get pods --all-namespaces -o json")).toBe(
      `get pods --all-namespaces -o json --watch-only --output-watch-events ${DEFAULT_WATCH_REQUEST_TIMEOUT}`,
    );
  });

  it("preserves explicit watch flags and request timeout", () => {
    expect(
      buildKubectlWatchCommand(
        "get deployments --all-namespaces -o json --watch-only --output-watch-events --request-timeout=90s",
      ),
    ).toBe(
      "get deployments --all-namespaces -o json --watch-only --output-watch-events --request-timeout=90s",
    );
  });
});
