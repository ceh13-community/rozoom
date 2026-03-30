import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConfigurationBulkActions from "./configuration-bulk-actions.svelte";

describe("configuration-bulk-actions", () => {
  it("shows port-forward preview in single mode when provided", async () => {
    const onPortForward = vi.fn();
    const { getByRole } = render(ConfigurationBulkActions, {
      props: {
        mode: "single",
        disabled: false,
        onShowDetails: vi.fn(),
        onEditYaml: vi.fn(),
        onCopyKubectlGetYaml: vi.fn(),
        onCopyKubectlDescribe: vi.fn(),
        onPortForward,
        onDelete: vi.fn(),
      },
    });

    await fireEvent.click(getByRole("button", { name: "Port-forward preview" }));
    expect(onPortForward).toHaveBeenCalledTimes(1);
  });

  it("shows run debug describe in single mode when provided", () => {
    const { getByRole } = render(ConfigurationBulkActions, {
      props: {
        mode: "single",
        disabled: false,
        onShowDetails: vi.fn(),
        onEditYaml: vi.fn(),
        onCopyKubectlGetYaml: vi.fn(),
        onCopyKubectlDescribe: vi.fn(),
        onRunDebugDescribe: vi.fn(),
        onDelete: vi.fn(),
      },
    });

    expect(getByRole("button", { name: "Run debug describe" })).toBeInTheDocument();
  });
});
