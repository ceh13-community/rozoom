import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Network debug in a namespace whose Pod Security level is baseline or restricted used to
// start anyway: a "Starting network debug..." toast, a kubectl debug call, then a red toast
// with the explanation and kubectl's raw Forbidden line. The namespace label is now read
// before anything runs; a sure refusal never starts, and the menu item carries the reason.
const list = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);
const table = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/data-table.svelte"),
  "utf8",
);
const menu = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pod-actions-menu.svelte"),
  "utf8",
);

describe("pods list network debug Pod Security contract", () => {
  it("checks the namespace before the confirm dialog, the Starting toast and kubectl", () => {
    const start = list.indexOf("async function startNetworkDebug(");
    const blocked = list.indexOf(
      "const blocked = networkDebugBlockReason(pod.metadata?.namespace);",
      start,
    );
    const confirm = list.indexOf("await confirmAction(", start);
    const starting = list.indexOf("toast.info(`Starting network debug in", start);
    const launch = list.indexOf("await startPodNetworkDebugSession(", start);
    expect(blocked).toBeGreaterThan(start);
    expect(blocked).toBeLessThan(confirm);
    expect(confirm).toBeLessThan(starting);
    expect(starting).toBeLessThan(launch);
    expect(list).toContain("if (blocked) {\n      toast.error(blocked);\n      return;\n    }");
  });

  it("reads the levels per cluster through the reader and leaves the menu enabled when they cannot be read", () => {
    expect(list).toContain("createNamespacePodSecurityReader((levels) => {");
    expect(list).toContain("void namespacePodSecurityReader.use(data.slug || null);");
    expect(list).toContain("let namespacePodSecurity = $state<Map<string, string> | null>(null);");
    expect(list).toContain("networkDebugPodSecurityBlock(ns, namespacePodSecurity?.get(ns))");
  });

  it("reads again when a row menu opens and when the window regains focus", () => {
    expect(list).toContain("onMenuOpen={() => void namespacePodSecurityReader.refresh()}");
    expect(list).toContain('window.addEventListener("focus", refreshNamespacePodSecurity);');
    expect(list).toContain('window.removeEventListener("focus", refreshNamespacePodSecurity)');
    expect(
      table.match(/onOpen=\{onMenuOpen \? \(\) => onMenuOpen\(row\) : undefined\}/g),
    ).toHaveLength(2);
    expect(menu).toContain("untrack(() => onOpen?.());");
  });

  it("a Pod Security refusal found only at launch is one sentence, kubectl's line goes to the log", () => {
    expect(list).toContain("if (error instanceof NetworkDebugRefusal && error.detail) {");
    expect(list).toContain(
      'void safeAppLog("warn", `[network-debug] ${getPodRef(pod)}: ${error.detail}`);',
    );
    expect(list).toContain("toast.error(error.message);\n        return;");
  });

  it("passes the reason down to every row menu, which disables the item and shows it", () => {
    expect(list).toContain(
      "networkDebugBlockedReason={(row) => networkDebugBlockReason(row.namespace)}",
    );
    expect(
      table.match(/networkDebugBlockedReason=\{networkDebugBlockedReason\?\.\(row\) \?\? null\}/g),
    ).toHaveLength(2);
    expect(menu).toContain("disabled={Boolean(networkDebugBlockedReason)}");
    expect(menu).toContain("{networkDebugBlockedReason}");
  });
});
