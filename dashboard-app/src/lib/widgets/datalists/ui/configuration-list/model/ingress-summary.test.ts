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

  const rule = (host: string | undefined, path: string) => ({
    ...(host ? { host } : {}),
    http: { paths: [{ path, backend: { service: { name: "web", port: { number: 80 } } } }] },
  });

  it("skips wildcard hosts for the URL, then uses the address, then has none", () => {
    expect(
      summarizeIngress(
        ingress({ rules: [rule("*.example.com", "/"), rule("shop.example.com", "/")] }),
      ).url,
    ).toBe("http://shop.example.com/");
    expect(
      summarizeIngress(
        ingress(
          { rules: [rule("*.example.com", "/app")] },
          { status: { loadBalancer: { ingress: [{ ip: "10.0.0.5" }] } } },
        ),
      ).url,
    ).toBe("http://10.0.0.5/app");
    expect(summarizeIngress(ingress({ rules: [rule("*.example.com", "/")] })).url).toBeNull();
  });

  it("puts an IPv6 address in brackets", () => {
    expect(
      summarizeIngress(
        ingress(
          { rules: [rule(undefined, "/")] },
          { status: { loadBalancer: { ingress: [{ ip: "2001:db8::10" }] } } },
        ),
      ).url,
    ).toBe("http://[2001:db8::10]/");
  });

  it("opens https when a TLS entry has no hosts", () => {
    expect(
      summarizeIngress(
        ingress({ tls: [{ secretName: "tls" }], rules: [rule("shop.example.com", "/")] }),
      ).url,
    ).toBe("https://shop.example.com/");
  });

  it("opens / for a regex path", () => {
    expect(
      summarizeIngress(ingress({ rules: [rule("shop.example.com", "/api(/|$)(.*)")] })).url,
    ).toBe("http://shop.example.com/");
  });
});
