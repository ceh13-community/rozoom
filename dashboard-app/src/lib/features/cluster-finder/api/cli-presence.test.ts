import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: (...args: unknown[]) => create(...args) },
}));

import { detectOsToolPresence } from "./cli-detection";

// Cloud Import offers an installed cloud CLI on slim. Whether it is installed is checked with
// `which` only: the CLI itself must not run before the person lists clusters.
describe("detectOsToolPresence", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockImplementation((program: string, args: string[]) => ({
      execute: async () =>
        program === "which" && args[0] === "aws"
          ? { code: 0, stdout: "/usr/local/bin/aws\n", stderr: "" }
          : { code: 1, stdout: "", stderr: "" },
    }));
  });

  it("reports installed tools from which, without running them", async () => {
    const found = await detectOsToolPresence(["aws", "gcloud"]);
    expect(found.map(({ tool, available, path }) => ({ tool, available, path }))).toEqual([
      { tool: "aws", available: true, path: "/usr/local/bin/aws" },
      { tool: "gcloud", available: false, path: null },
    ]);
    expect(create.mock.calls.every(([program]) => program === "which")).toBe(true);
  });
});
