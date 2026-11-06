import { fireEvent, render } from "@testing-library/svelte";
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

  it("confirms a replica count the user changed", async () => {
    const onConfirm = vi.fn();
    const { getByLabelText, getByRole } = render(ScaleDialog, {
      props: {
        open: true,
        resourceKind: "Deployment",
        resourceName: "my-api",
        namespace: "prod",
        currentReplicas: 2,
        onConfirm,
        onCancel: vi.fn(),
      },
    });

    await fireEvent.input(getByLabelText("Desired replica count"), { target: { value: "3" } });
    await fireEvent.click(getByRole("button", { name: "Scale to 3 replicas" }));

    expect(onConfirm).toHaveBeenCalledWith(3);
  });

  it("confirms an edited count with Enter", async () => {
    const onConfirm = vi.fn();
    const { getByLabelText } = render(ScaleDialog, {
      props: {
        open: true,
        resourceKind: "Deployment",
        resourceName: "my-api",
        namespace: "prod",
        currentReplicas: 3,
        onConfirm,
        onCancel: vi.fn(),
      },
    });

    const input = getByLabelText("Desired replica count");
    await fireEvent.input(input, { target: { value: "2" } });
    await fireEvent.keyDown(input, { key: "Enter" });

    expect(onConfirm).toHaveBeenCalledWith(2);
  });

  it("uses the singular label when the user changes the count to 1", async () => {
    const { getByLabelText, getByRole } = render(ScaleDialog, {
      props: {
        open: true,
        resourceKind: "Deployment",
        resourceName: "my-api",
        namespace: "prod",
        currentReplicas: 2,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    await fireEvent.input(getByLabelText("Desired replica count"), { target: { value: "1" } });

    expect(getByRole("button", { name: "Scale to 1 replica" })).toBeInTheDocument();
  });

  it("rejects an emptied count with a message", async () => {
    const onConfirm = vi.fn();
    const { getByLabelText, getByRole, getByText } = render(ScaleDialog, {
      props: {
        open: true,
        resourceKind: "Deployment",
        resourceName: "my-api",
        namespace: "prod",
        currentReplicas: 2,
        onConfirm,
        onCancel: vi.fn(),
      },
    });

    await fireEvent.input(getByLabelText("Desired replica count"), { target: { value: "" } });
    await fireEvent.click(getByRole("button", { name: /^Scale to/ }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(getByText("Replica count must be a non-negative integer.")).toBeInTheDocument();
  });
});
