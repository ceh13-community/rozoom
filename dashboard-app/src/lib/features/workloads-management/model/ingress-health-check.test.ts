import { describe, expect, it } from "vitest";
import { evaluateIngressHealth } from "./ingress-health-check";

describe("ingress-health-check", () => {
  it("scores healthy ingress with TLS", () => {
    const result = evaluateIngressHealth([
      {
        metadata: { name: "web", namespace: "prod" },
        spec: {
          tls: [{ hosts: ["web.example.com"] }],
          rules: [{ host: "web.example.com", http: { paths: [{ backend: {} }] } }],
        },
        status: { loadBalancer: { ingress: [{ ip: "1.2.3.4" }] } },
      },
    ]);
    expect(result.entries[0].score).toBe(100);
    expect(result.withoutTls).toBe(0);
  });

  it("penalizes missing TLS", () => {
    const result = evaluateIngressHealth([
      {
        metadata: { name: "api", namespace: "prod" },
        spec: { rules: [{ host: "api.example.com", http: { paths: [{ backend: {} }] } }] },
        status: {},
      },
    ]);
    expect(result.entries[0].hasTls).toBe(false);
    expect(result.entries[0].score).toBeLessThan(100);
    expect(result.withoutTls).toBe(1);
  });
});
