import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import DeleteConfirmDialog, { type DeleteTarget } from "./delete-confirm-dialog.svelte";

const podTarget: DeleteTarget = {
  kind: "pod",
  name: "nginx-abcde",
  namespace: "default",
  command: "delete pod nginx-abcde -n default",
};

describe("DeleteConfirmDialog", () => {
  it("shows the exact kubectl command that will run", () => {
    const { getByText } = render(DeleteConfirmDialog, {
      props: {
        open: true,
        targets: [podTarget],
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(getByText("Delete pod")).toBeInTheDocument();
    expect(getByText("$ kubectl delete pod nginx-abcde -n default")).toBeInTheDocument();
    expect(getByText(/- pod\/nginx-abcde/)).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { getByText } = render(DeleteConfirmDialog, {
      props: { open: true, targets: [podTarget], onConfirm, onCancel },
    });

    getByText("Confirm delete").click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when the cancel button is clicked", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { getByText } = render(DeleteConfirmDialog, {
      props: { open: true, targets: [podTarget], onConfirm, onCancel },
    });

    getByText("Cancel").click();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("summarises the count when deleting multiple resources", () => {
    const { getByText } = render(DeleteConfirmDialog, {
      props: {
        open: true,
        targets: [
          podTarget,
          {
            kind: "pod",
            name: "redis-xyz",
            namespace: "cache",
            command: "delete pod redis-xyz -n cache",
          },
        ],
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    expect(getByText("Delete 2 resources")).toBeInTheDocument();
    expect(getByText("$ kubectl delete pod redis-xyz -n cache")).toBeInTheDocument();
  });
});
