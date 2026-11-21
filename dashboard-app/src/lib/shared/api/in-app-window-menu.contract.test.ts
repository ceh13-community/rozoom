import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The app's Help menu is app-wide; Rust drops it from in-app preview windows by label
// prefix. Both sides must use the same prefix, or port-forward pages get the menu back.
describe("in-app preview windows have no Help menu", () => {
  it("names preview windows with the prefix the Rust page-load hook checks", () => {
    const browser = readFileSync(resolve(__dirname, "in-app-browser.ts"), "utf8");
    const rust = readFileSync(
      resolve(__dirname, "../../../../src-tauri/src/support_logs.rs"),
      "utf8",
    );
    const main = readFileSync(resolve(__dirname, "../../../../src-tauri/src/main.rs"), "utf8");
    const prefix = /pub const IN_APP_WINDOW_PREFIX: &str = "([^"]+)";/.exec(rust)?.[1];
    expect(prefix).toBe("inapp-");
    expect(browser).toContain("const label = `inapp-${");
    expect(main).toContain(
      ".on_page_load(|webview, _payload| support_logs::drop_menu_from_preview(webview))",
    );
  });
});
