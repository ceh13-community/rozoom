import { describe, expect, it } from "vitest";
import { summarizeIngress } from "./ingress-summary";

const ingress = (spec: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  metadata: { name: "web", namespace: "shop" },
  spec,
  ...extra,
});

describe("summarizeIngress", () => {
  it("shows what kubectl get ingress shows", () => {
    const summary = summarizeIngress(
      ingress(
        {
          ingressClassName: "nginx",
          rules: [
            {
              host: "shop.example.com",
              http: {
                paths: [
                  { path: "/api", backend: { service: { name: "api", port: { number: 8080 } } } },
                ],
              },
            },
            {
              host: "admin.example.com",
              http: {
                paths: [
                  { path: "/", backend: { service: { name: "admin", port: { name: "http" } } } },
                ],
              },
            },
          ],
        },
        { status: { loadBalancer: { ingress: [{ ip: "192.168.49.2" }] } } },
      ),
    );
    expect(summary).toMatchObject({
      className: "nginx",
      hosts: ["shop.example.com", "admin.example.com"],
      address: "192.168.49.2",
      ports: "80",
      url: "http://shop.example.com/api",
    });
    expect(summary.rules).toEqual([
      { host: "shop.example.com", path: "/api", service: "api", port: "8080" },
      { host: "admin.example.com", path: "/", service: "admin", port: "http" },
    ]);
  });

  it("opens https for a host under TLS and adds port 443", () => {
    const summary = summarizeIngress(
      ingress({
        tls: [{ hosts: ["shop.example.com"], secretName: "tls" }],
        rules: [
          {
            host: "shop.example.com",
            http: {
              paths: [{ path: "/", backend: { service: { name: "web", port: { number: 80 } } } }],
            },
          },
        ],
      }),
    );
    expect(summary.ports).toBe("80, 443");
    expect(summary.url).toBe("https://shop.example.com/");
  });

  it("uses the address when the rules have no host, and the old class annotation", () => {
    const summary = summarizeIngress(
      ingress(
        {
          rules: [
            {
              http: {
                paths: [
                  { path: "/app", backend: { service: { name: "web", port: { number: 80 } } } },
                ],
              },
            },
          ],
        },
        {
          metadata: {
            name: "web",
            namespace: "shop",
            annotations: { "kubernetes.io/ingress.class": "traefik" },
          },
          status: { loadBalancer: { ingress: [{ hostname: "lb.example.net" }] } },
        },
      ),
    );
    expect(summary).toMatchObject({
      className: "traefik",
      hosts: ["*"],
      address: "lb.example.net",
      url: "http://lb.example.net/app",
    });
  });

  it("has no URL without a host or an address, and lists the default backend", () => {
    const summary = summarizeIngress(
      ingress({ defaultBackend: { service: { name: "fallback", port: { number: 80 } } } }),
    );
    expect(summary.url).toBeNull();
    expect(summary.address).toBe("-");
    expect(summary.rules).toEqual([
      { host: "*", path: "(default)", service: "fallback", port: "80" },
    ]);
  });
});
