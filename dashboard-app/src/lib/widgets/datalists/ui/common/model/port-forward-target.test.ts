import { describe, expect, it } from "vitest";
import {
  parsePortInput,
  podPortForwardTarget,
  portForwardKey,
  servicePortForwardTarget,
} from "./port-forward-target";

describe("port-forward targets", () => {
  it("lists every TCP container port of a pod, web ports first, once each", () => {
    const target = podPortForwardTarget({
      metadata: { name: "web-1", namespace: "shop" },
      spec: {
        containers: [
          {
            name: "app",
            ports: [
              { name: "metrics", containerPort: 9090 },
              { name: "http", containerPort: 8080 },
              { name: "dns", containerPort: 53, protocol: "UDP" },
            ],
          },
          { name: "proxy", ports: [{ containerPort: 8443 }, { containerPort: 8080 }] },
        ],
      },
    });
    expect(target).toMatchObject({ kind: "pod", namespace: "shop", name: "web-1" });
    expect(target.ports).toEqual([
      { port: 8080, name: "http", container: "app", scheme: "http" },
      { port: 8443, name: "", container: "proxy", scheme: "https" },
      { port: 9090, name: "metrics", container: "app", scheme: "http" },
    ]);
  });

  it("gives a pod without declared ports an empty list (the port is typed)", () => {
    const target = podPortForwardTarget({
      metadata: { name: "busybox", namespace: "default" },
      spec: { containers: [{ name: "sh" }] },
    });
    expect(target.ports).toEqual([]);
  });

  it("lists the TCP ports of a service with their scheme", () => {
    const target = servicePortForwardTarget({
      metadata: { name: "api", namespace: "shop" },
      spec: {
        ports: [
          { name: "prometheus", port: 9100 },
          { name: "https", port: 443 },
          { name: "grpc", port: 9000, protocol: "UDP" },
        ],
      },
    });
    expect(target.ports.map((p) => [p.port, p.scheme])).toEqual([
      [443, "https"],
      [9100, "http"],
    ]);
  });

  it("uses the Network > Port Forwarding key format", () => {
    const target = podPortForwardTarget({ metadata: { name: "web-1", namespace: "shop" } });
    expect(portForwardKey("minikube", target, 30080, 80)).toBe("minikube:shop:pod/web-1:30080:80");
  });

  it("accepts ports 1-65535 only", () => {
    expect(parsePortInput(" 8080 ")).toBe(8080);
    expect(parsePortInput(8080)).toBe(8080);
    for (const bad of ["", "0", "65536", "80a", "-1", "8.5", null]) {
      expect(parsePortInput(bad)).toBeNull();
    }
  });
});
