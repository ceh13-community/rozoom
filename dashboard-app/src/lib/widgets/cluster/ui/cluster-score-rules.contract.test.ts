import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The posture card used to show only the top three risks, without the objects behind them.
// Thirteen of sixteen rules were invisible, so a red manifest could not be traced to a rule.
// Every rule is now listed with its status word and the namespace/name of what it found.
const scoreCard = readFileSync(resolve(__dirname, "cluster-score.svelte"), "utf8");

describe("cluster score rules list", () => {
  it("lists every rule behind an expander, grouped by category", () => {
    expect(scoreCard).toContain('data-testid="cluster-score-rules"');
    expect(scoreCard).toContain("All rules ({ruleCounts.total})");
    expect(scoreCard).toContain("{#each ruleGroups as group (group.id)}");
    expect(scoreCard).toContain("{#each group.rules as rule (rule.id)}");
  });

  it("states each rule status in words, not only by color or icon", () => {
    expect(scoreCard).toContain('data-testid="cluster-score-rule-status">{rule.statusLabel}');
    expect(scoreCard).toContain("data-rule-status={rule.status}");
    expect(scoreCard).toContain('aria-hidden="true">{ruleIcon(rule.status)}');
  });

  it("shows the objects a fired rule points at, with a cap", () => {
    expect(scoreCard).toContain('data-testid="cluster-score-rule-reference"');
    expect(scoreCard).toContain("{#each visibleReferences(rule) as reference (reference)}");
    expect(scoreCard).toContain("+{hiddenReferenceCount(rule)} more");
  });

  it("keeps the top risks and the existing explanations", () => {
    expect(scoreCard).toContain("Top risks");
    expect(scoreCard.indexOf("Top risks")).toBeLessThan(
      scoreCard.indexOf('data-testid="cluster-score-rules"'),
    );
    expect(scoreCard.indexOf('data-testid="cluster-score-rules"')).toBeLessThan(
      scoreCard.indexOf("Indicator explanations"),
    );
  });
});
