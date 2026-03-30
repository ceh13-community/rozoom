import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/widgets/cluster/ui/cluster-info-card.svelte"), "utf8");

describe("cluster info card diagnostics queue", () => {
  it("keeps manual diagnostics scopes independent and queued per button", () => {
    expect(source).toContain('type CardDiagnosticsScope = "config" | "health" | "infrastructure";');
    expect(source).toContain(
      "let activeCardDiagnosticsScope = $state<CardDiagnosticsScope | null>(null);",
    );
    expect(source).toContain(
      "let queuedCardDiagnosticsScopes = $state<CardDiagnosticsScope[]>([]);",
    );
    expect(source).toContain("function requestCardDiagnostics(scope: CardDiagnosticsScope) {");
    expect(source).toContain("enqueueCardDiagnostics(scope);");
    expect(source).toContain('onclick={() => requestCardDiagnostics("config")}');
    expect(source).toContain('onclick={() => requestCardDiagnostics("health")}');
  });

  it("drains the queued diagnostics scopes serially instead of firing both immediately", () => {
    expect(source).toContain("if (activeCardDiagnosticsScope) return;");
    expect(source).toContain("if (queuedCardDiagnosticsScopes.length === 0) return;");
    expect(source).toContain("const [nextScope, ...rest] = queuedCardDiagnosticsScopes;");
    expect(source).toContain("activeCardDiagnosticsScope = nextScope;");
    expect(source).toContain("void bootstrapCardDiagnostics(nextScope).finally(() => {");
    expect(source).toContain("activeCardDiagnosticsScope = null;");
  });

  it("surfaces per-button loading and queued states in the diagnostics banners", () => {
    expect(source).toContain('{#if activeCardDiagnosticsScope === "config"}');
    expect(source).toContain('{:else if isDiagnosticsScopeQueued("config")}');
    expect(source).toContain('{#if activeCardDiagnosticsScope === "health"}');
    expect(source).toContain('{:else if isDiagnosticsScopeQueued("health")}');
    expect(source).toContain("Queued by policy");
    expect(source).toContain("Loading<LoadingDots />");
  });
});
