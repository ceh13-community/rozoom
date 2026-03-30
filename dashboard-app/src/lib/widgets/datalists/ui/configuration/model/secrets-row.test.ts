import { describe, expect, it } from "vitest";
import { createSecretRows, filterSecretRows } from "./secrets-row";

describe("secrets-row model", () => {
  it("adapts secret rows and filters by secret-specific signal fields", () => {
    const rows = createSecretRows([
      {
        metadata: {
          uid: "sec-1",
          name: "registry-creds",
          namespace: "default",
          creationTimestamp: "2026-03-01T00:00:00Z",
          labels: { app: "api", team: "platform" },
        },
        type: "kubernetes.io/dockerconfigjson",
        data: { ".dockerconfigjson": "encoded" },
      },
      {
        metadata: {
          uid: "sec-2",
          name: "tls-api",
          namespace: "edge",
          creationTimestamp: "2026-03-02T00:00:00Z",
          labels: {},
        },
        type: "kubernetes.io/tls",
        data: { "tls.crt": "crt", "tls.key": "key" },
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      uid: "sec-1",
      name: "registry-creds",
      namespace: "default",
      type: "kubernetes.io/dockerconfigjson",
      keys: 1,
      labels: 2,
      signal: "Registry credentials",
    });
    expect(rows[1]).toMatchObject({
      uid: "sec-2",
      name: "tls-api",
      namespace: "edge",
      type: "kubernetes.io/tls",
      keys: 2,
      labels: 0,
      signal: "TLS material",
    });

    expect(filterSecretRows(rows, "registry").map((row) => row.name)).toEqual(["registry-creds"]);
    expect(filterSecretRows(rows, "tls material").map((row) => row.name)).toEqual(["tls-api"]);
  });
});
