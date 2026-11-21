import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appDir = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(appDir, file), "utf8");

const handlerBlock =
  /generate_handler!\[([\s\S]*?)\]/.exec(read("src-tauri/src/main.rs"))?.[1] ?? "";
const handlerCommands = [...handlerBlock.matchAll(/(?:\w+::)*(\w+)\s*,?/g)].map(([, name]) => name);

const buildRs = read("src-tauri/build.rs");
const manifestBlock = /const APP_COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(buildRs)?.[1] ?? "";
const manifestCommands = [...manifestBlock.matchAll(/"([a-z_]+)"/g)].map(([, name]) => name);

type Capability = { windows: string[]; remote?: unknown; permissions: unknown[] };
const capabilities: Record<string, Capability> = {
  default: JSON.parse(read("src-tauri/capabilities/default.json")) as Capability,
  slim: JSON.parse(read("src-tauri/capabilities/slim.json")) as Capability,
};

const permissionFor = (command: string) => `allow-${command.replace(/_/g, "-")}`;

// Without an app manifest Tauri runs app commands for any window that has IPC,
// including in-app browser windows (inapp-*) that show port-forwarded pods and
// other pages the app does not control. The manifest turns on the ACL, so a
// command runs only where a capability grants it: the main window.
describe("app command ACL", () => {
  it("finds the registered commands", () => {
    expect(handlerCommands).toContain("read_recent_log_tail");
    expect(handlerCommands).toContain("relax_webview_tls");
  });

  it("puts every registered command in the app manifest, and nothing else", () => {
    expect(buildRs).toMatch(
      /app_manifest\(tauri_build::AppManifest::new\(\)\.commands\(APP_COMMANDS\)\)/,
    );
    expect([...manifestCommands].sort()).toEqual([...handlerCommands].sort());
  });

  it.each(Object.keys(capabilities))(
    "%s capability grants the commands to the main window only",
    (name) => {
      const capability = capabilities[name];
      expect(capability.windows).toEqual(["main"]);
      expect(capability.remote).toBeUndefined();
      for (const command of handlerCommands) {
        expect(capability.permissions).toContain(permissionFor(command));
      }
    },
  );

  it("no capability targets in-app browser windows", () => {
    for (const capability of Object.values(capabilities)) {
      expect(
        capability.windows.some((label) => label.startsWith("inapp") || label.includes("*")),
      ).toBe(false);
    }
  });
});
