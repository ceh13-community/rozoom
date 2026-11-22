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

  // Exit 1 is "not found". A which that exits otherwise or does not start says nothing about
  // the tool: it is left out (unknown) instead of reading as removed.
  it("leaves out tools whose which exits with another code or does not start", async () => {
    create.mockImplementation((_program: string, args: string[]) => ({
      execute: async () => {
        if (args[0] === "gcloud") throw new Error("which: failed to start");
        return args[0] === "az"
          ? { code: 2, stdout: "", stderr: "which: invalid option" }
          : { code: 1, stdout: "", stderr: "" };
      },
    }));
    const found = await detectOsToolPresence(["aws", "gcloud", "az"]);
    expect(found.map(({ tool, available }) => ({ tool, available }))).toEqual([
      { tool: "aws", available: false },
    ]);
  });
});
