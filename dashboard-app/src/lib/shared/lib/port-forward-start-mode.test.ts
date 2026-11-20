import { describe, expect, it } from "vitest";
import { defaultLocalPort } from "./port-forward-start-mode";

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
});
