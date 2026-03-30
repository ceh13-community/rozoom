import { describe, expect, it } from "vitest";
import { auditSecretRotation } from "./secret-rotation-audit";

describe("secret-rotation-audit", () => {
  const now = new Date("2026-03-21T12:00:00Z").getTime();
  const daysAgo = (days: number) => new Date(now - days * 86400000).toISOString();

  const secret = (name: string, ns: string, createdAt: string, type = "Opaque", keys = 2) => ({
    metadata: { name, namespace: ns, creationTimestamp: createdAt },
    type,
    data: Object.fromEntries(Array.from({ length: keys }, (_, i) => [`key${i}`, "val"])),
  });

  it("categorizes secrets by age", () => {
    const result = auditSecretRotation(
      [
        secret("fresh-secret", "default", daysAgo(5)),
        secret("aging-secret", "default", daysAgo(45)),
        secret("stale-secret", "default", daysAgo(120)),
        secret("critical-secret", "default", daysAgo(400)),
      ],
      { now },
    );

    expect(result.fresh).toBe(1);
    expect(result.aging).toBe(1);
    expect(result.stale).toBe(1);
    expect(result.critical).toBe(1);
  });

  it("skips system secrets by default", () => {
    const result = auditSecretRotation(
      [
        secret("my-secret", "default", daysAgo(100)),
        secret("sa-token", "default", daysAgo(200), "kubernetes.io/service-account-token"),
        secret("default-token-abc", "default", daysAgo(300)),
        secret("sh.helm.release.v1.app.v1", "default", daysAgo(300)),
      ],
      { now },
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe("my-secret");
  });

  it("includes system secrets when option set", () => {
    const result = auditSecretRotation(
      [secret("sa-token", "default", daysAgo(200), "kubernetes.io/service-account-token")],
      { now, includeSystemSecrets: true },
    );

    expect(result.entries).toHaveLength(1);
  });

  it("calculates rotation score", () => {
    const allFresh = auditSecretRotation(
      [secret("a", "default", daysAgo(1)), secret("b", "default", daysAgo(2))],
      { now },
    );
    expect(allFresh.rotationScore).toBe(100);

    const allStale = auditSecretRotation(
      [secret("a", "default", daysAgo(100)), secret("b", "default", daysAgo(100))],
      { now },
    );
    expect(allStale.rotationScore).toBeLessThan(50);
  });

  it("sorts by age descending (oldest first)", () => {
    const result = auditSecretRotation(
      [
        secret("new", "default", daysAgo(5)),
        secret("old", "default", daysAgo(200)),
        secret("mid", "default", daysAgo(60)),
      ],
      { now },
    );

    expect(result.entries[0].name).toBe("old");
    expect(result.entries[2].name).toBe("new");
  });

  it("computes median and oldest age", () => {
    const result = auditSecretRotation(
      [
        secret("a", "default", daysAgo(10)),
        secret("b", "default", daysAgo(50)),
        secret("c", "default", daysAgo(200)),
      ],
      { now },
    );

    expect(result.oldestAgeDays).toBe(200);
    expect(result.medianAgeDays).toBe(50);
  });
});
