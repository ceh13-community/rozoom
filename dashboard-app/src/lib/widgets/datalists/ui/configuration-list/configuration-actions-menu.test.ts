import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConfigurationActionsMenu from "./configuration-actions-menu.svelte";

const configurationActionsMenuSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/configuration-list/configuration-actions-menu.svelte"),
  "utf8",
);

describe("configuration-actions-menu", () => {
  it("renders trigger button", () => {
    const { getByRole } = render(ConfigurationActionsMenu, {
      props: {
        name: "cm-a",
        namespace: "default",
        onShowDetails: vi.fn(),
        onEditYaml: vi.fn(),
        onCopyKubectlGetYaml: vi.fn(),
        onCopyKubectlDescribe: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByRole("button", { name: "Open actions for cm-a" })).toBeInTheDocument();
  });

  it("keeps port-forward preview action wired for services", () => {
    expect(configurationActionsMenuSource).toContain("onPortForward");
    expect(configurationActionsMenuSource).toContain("Port-forward preview");
  });

  it("exposes run debug describe when provided", () => {
    expect(configurationActionsMenuSource).toContain("onRunDebugDescribe");
    expect(configurationActionsMenuSource).toContain("Run debug describe");
  });
});
