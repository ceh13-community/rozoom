import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ScaleDialog from "./scale-dialog.svelte";

describe("ScaleDialog", () => {
  it("renders with resource info and current replica count", () => {
    const { getByText, getByLabelText } = render(ScaleDialog, {
      props: {
        open: true,
        resourceKind: "Deployment",
        resourceName: "my-api",
        namespace: "prod",
        currentReplicas: 3,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(getByText("Scale Deployment")).toBeInTheDocument();
    expect(getByText("prod/my-api - currently 3 replicas")).toBeInTheDocument();
    expect(getByLabelText("Desired replica count")).toHaveValue(3);
  });

  it("shows singular replica text for count of 1", () => {
    const { getByText } = render(ScaleDialog, {
      props: {
        open: true,
        resourceKind: "StatefulSet",
        resourceName: "redis",
        namespace: "default",
        currentReplicas: 1,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(getByText("default/redis - currently 1 replica")).toBeInTheDocument();
  });
});
