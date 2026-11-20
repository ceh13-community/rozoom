import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ATTACH_HINT, SHELL_HINT, podSessionLine } from "./pod-access-hints";
import { DISK_USAGE_HINT, PVC_USAGE_NOTICES } from "../common/pvc-usage-notice";

const KEYBOARD_ONLY = /^[\x20-\x7E]*$/;

describe("Shell and Attach texts", () => {
  it("names the container, or the main container when it is unknown", () => {
    expect(podSessionLine("pod-exec", "app")).toBe(
      "Each command runs as a new process in container app. Full-screen programs such as vi or top do not work here.",
    );
    expect(podSessionLine("pod-attach", undefined)).toBe(
      "Showing what the running process of the main container prints. Read-only: input is not sent. This is not a shell.",
    );
  });

  it("does not call Attach a terminal or promise input", () => {
    expect(ATTACH_HINT).toMatch(/Read-only/);
    expect(ATTACH_HINT).not.toMatch(/terminal|send it input/i);
    expect(SHELL_HINT).not.toMatch(/interactive/i);
  });

  it("uses keyboard characters only", () => {
    const texts = [
      SHELL_HINT,
      ATTACH_HINT,
      podSessionLine("pod-exec", "app"),
      podSessionLine("pod-attach", "app"),
      DISK_USAGE_HINT,
      ...Object.values(PVC_USAGE_NOTICES).map((notice) => notice.text),
    ];
    for (const text of texts) expect(text).toMatch(KEYBOARD_ONLY);
  });

  it("shows the hints on the Shell and Attach menu items", () => {
    const menu = readFileSync(resolve(__dirname, "pod-actions-menu.svelte"), "utf8");
    expect(menu).toMatch(/title=\{SHELL_HINT\}[\s\S]{0,200}Shell/);
    expect(menu).toMatch(/title=\{ATTACH_HINT\}[\s\S]{0,200}Attach pod/);
  });
});
