import { describe, expect, it, vi } from "vitest";
import { forceFinalizeConfirmText, forceFinalizeNamespace } from "./namespace-finalize";

const terminating = {
  metadata: { name: "shop", deletionTimestamp: "2026-11-22T06:00:00Z" },
  spec: { finalizers: ["kubernetes"] },
  status: { phase: "Terminating" },
};

function deps(namespace: unknown, replace = { output: "", errors: "", code: 0 }) {
  const files = new Map<string, string>();
  return {
    files,
    kubectl: vi.fn(async (args: string[]) =>
      args[0] === "get" ? { output: JSON.stringify(namespace), errors: "", code: 0 } : replace,
    ),
    writeTempFile: vi.fn(async (content: string) => {
      files.set("/tmp/ns.json", content);
      return "/tmp/ns.json";
    }),
    removeFile: vi.fn(async (path: string) => {
      files.delete(path);
    }),
  };
}

// A merge patch on spec.finalizers answered "patched (no change)" and the app reported the
// finalizers removed: they change only through the finalize subresource, with a PUT.
describe("forceFinalizeNamespace", () => {
  it("sends the namespace with no finalizers to the finalize subresource", async () => {
    const d = deps(terminating);
    let sent = "";
    d.kubectl.mockImplementation(async (args: string[]) => {
      if (args[0] === "get") return { output: JSON.stringify(terminating), errors: "", code: 0 };
      sent = d.files.get(args[4]) ?? "";
      return { output: "", errors: "", code: 0 };
    });

    expect(await forceFinalizeNamespace("shop", d)).toEqual({ ok: true });
    expect(d.kubectl).toHaveBeenLastCalledWith([
      "replace",
      "--raw",
      "/api/v1/namespaces/shop/finalize",
      "-f",
      "/tmp/ns.json",
    ]);
    expect(JSON.parse(sent).spec.finalizers).toEqual([]);
    expect(d.files.size).toBe(0);
  });

  it("refuses a namespace that is not being deleted", async () => {
    const d = deps({ ...terminating, metadata: { name: "shop" }, status: { phase: "Active" } });
    const result = await forceFinalizeNamespace("shop", d);
    expect(result.ok).toBe(false);
    expect(d.writeTempFile).not.toHaveBeenCalled();
  });

  it("reports kubectl's error and still removes the temp file", async () => {
    const d = deps(terminating, { output: "", errors: "Forbidden", code: 1 });
    expect(await forceFinalizeNamespace("shop", d)).toEqual({ ok: false, error: "Forbidden" });
    expect(d.files.size).toBe(0);
  });

  it("says what is lost before the person agrees", () => {
    const text = forceFinalizeConfirmText("shop");
    expect(text).toContain("stuck in Terminating");
    expect(text).toContain("load balancers, volumes and DNS records");
    expect(text).toContain("cannot be undone");
  });
});
