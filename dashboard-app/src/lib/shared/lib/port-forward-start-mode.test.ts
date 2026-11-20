import { describe, expect, it } from "vitest";
import { defaultLocalPort, portForwardLocalUrl } from "./port-forward-start-mode";

describe("defaultLocalPort", () => {
  // kubectl port-forward 80:80 as a normal user: "unable to listen on any of the requested
  // ports: [{80 80}]". Pods serving on 80 or 443 could not be forwarded at all.
  it("moves ports that need root to an unprivileged local port", () => {
    expect(defaultLocalPort(80)).toBe(30080);
    expect(defaultLocalPort(443)).toBe(30443);
    expect(defaultLocalPort(1023)).toBe(31023);
  });

  it("keeps an unprivileged remote port as the local port", () => {
    expect(defaultLocalPort(1024)).toBe(1024);
    expect(defaultLocalPort(8080)).toBe(8080);
    expect(defaultLocalPort(9100)).toBe(9100);
  });

  // A second pod on 80 asked for 30080 again and failed with "already in use".
  it("skips local ports the app's other forwards hold", () => {
    expect(defaultLocalPort(80, new Set([30080]))).toBe(30081);
    expect(defaultLocalPort(80, new Set([30080, 30081]))).toBe(30082);
    expect(defaultLocalPort(8080, new Set([8080]))).toBe(8081);
    expect(defaultLocalPort(8080, new Set([30080]))).toBe(8080);
  });

  it("stays at the preferred port when every port above it is taken", () => {
    expect(defaultLocalPort(65535, new Set([65535]))).toBe(65535);
  });
});

describe("portForwardLocalUrl", () => {
  it("points at 127.0.0.1, where kubectl listens", () => {
    expect(portForwardLocalUrl(30080, 80)).toBe("http://127.0.0.1:30080");
    expect(portForwardLocalUrl(30443, 443)).toBe("https://127.0.0.1:30443");
    expect(portForwardLocalUrl(8443, 8443)).toBe("https://127.0.0.1:8443");
  });
});
