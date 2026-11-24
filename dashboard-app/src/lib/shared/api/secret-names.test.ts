import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront: vi.fn() }));

import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { SECRET_NAMES_OUTPUT, listSecretNames, parseSecretNames } from "./secret-names";

const mockedRawArgs = vi.mocked(kubectlRawArgsFront);

describe("listSecretNames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks kubectl for namespace and name only", async () => {
    mockedRawArgs.mockResolvedValueOnce({ output: "app\tdb-password\n", errors: "", code: 0 });

    const result = await listSecretNames(["-n", "app"], { clusterId: "c1" });

    expect(mockedRawArgs).toHaveBeenCalledWith(
      ["get", "secrets", "-n", "app", "-o", SECRET_NAMES_OUTPUT],
      { clusterId: "c1" },
    );
    expect(result).toEqual({ items: [{ metadata: { namespace: "app", name: "db-password" } }] });
    expect(SECRET_NAMES_OUTPUT).toMatch(/^jsonpath=/);
    // Only these two fields are read from each secret.
    expect(SECRET_NAMES_OUTPUT.match(/\{\.[^}]+\}/g)).toEqual([
      "{.metadata.namespace}",
      "{.metadata.name}",
    ]);
  });

  it("returns the kubectl error text", async () => {
    mockedRawArgs.mockResolvedValueOnce({ output: "", errors: "forbidden", code: 1 });
    expect(await listSecretNames(["-A"], { clusterId: "c1" })).toBe("forbidden");
  });

  it("skips lines that are not a namespace and a name", () => {
    expect(
      parseSecretNames(["a\tone", "Bad\tx", "a\tb\tc", "", "a\ttwo"].join("\n")).map(
        (ref) => ref.metadata.name,
      ),
    ).toEqual(["one", "two"]);
  });
});

// Both panels only use metadata.namespace and metadata.name of a secret. A list
// with -o json would bring every key and password in scope into the app.
describe.each([
  "src/lib/widgets/cluster/ui/resource-map-panel.svelte",
  "src/lib/shared/plugins/contrib/workload-visualizer/visualizer-panel.svelte",
])("%s", (file) => {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");

  it("lists secrets through listSecretNames, never whole with -o json or yaml", () => {
    expect(source).toContain("listSecretNames(");
    // A "kubectl get secret <name>" hint the panel shows as text is fine.
    expect(source).not.toMatch(/get secrets?\b[^\n]*-o\s*(json|yaml)/);
    expect(source).not.toMatch(/kubectlJson[^\n]*secret/i);
  });

  it("a failed secrets listing leaves the rest of the panel working", () => {
    // Resource map: Promise.all, so the call must not reject. Workload map: Promise.allSettled.
    expect(source).toMatch(/listSecretNames\([^;]*\.catch\(\(\) => null\)|Promise\.allSettled\(/);
  });
});
