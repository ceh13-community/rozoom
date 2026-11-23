import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// WebKitGTK shows window.prompt/confirm/alert as a system window titled
// "JavaScript - tauri://localhost/...", and the dialog plugin's ask/confirm open a window of
// their own that can hide behind the app. The app uses its own dialogs instead: requestText
// (text), ScaleDialog (replicas), confirmAction and safeDialogAsk (a titled question through
// ConfirmDialogHost, with the system dialog only as the fallback inside the two files below).
const SRC = resolve(__dirname, "../../..");
const ALLOWED = new Set([
  // Fallbacks: a webview without the host, outside Tauri, or when the dialog plugin throws.
  "lib/shared/lib/confirm-action.ts",
  "lib/shared/lib/tauri-runtime.ts",
  // Not routed anywhere (Services render through configuration-list).
  "lib/widgets/datalists/ui/network/model/service-port-forward.ts",
]);
const NATIVE = /(?<![\w.$])(?:window\.)?(?:prompt|confirm|alert|ask)\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(svelte|ts)$/.test(name) || /\.test\.ts$/.test(name)) return [];
    return [path];
  });
}

describe("no native prompt, confirm or alert", () => {
  it("leaves them only in the browser fallbacks", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) =>
        readFileSync(join(SRC, file), "utf8")
          .split("\n")
          .some(
            (line) =>
              !line.trim().startsWith("//") && NATIVE.test(line.replace(/function \w+\(/, "")),
          ),
      );
    expect(offenders).toEqual([]);
  });
});
