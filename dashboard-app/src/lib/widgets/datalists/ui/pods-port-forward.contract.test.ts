import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The pod menu forwarded localhost:<containerPort>. For a pod serving on 80 that needs root
// on Linux, so kubectl failed with "unable to listen on any of the requested ports".
describe("pod port-forward local port", () => {
  const source = readFileSync(resolve(__dirname, "pods-list/pods-list.svelte"), "utf8");
  const start = source.indexOf("async function handlePortForward(");
  const body = source.slice(start, source.indexOf("\n  }\n", start));

  it("starts the forward on an unprivileged local port", () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toContain("const localPort = defaultLocalPort(firstPort, usedLocalPorts());");
    expect(body).toMatch(/remotePort: firstPort,\s*localPort,/);
  });

  it("shows and opens 127.0.0.1 on the local port, not the container port", () => {
    expect(body).toContain("const url = portForwardLocalUrl(localPort, firstPort);");
    expect(body).toContain("`Port-forward started: ${url} -> ${name}:${firstPort}`");
    expect(body).toContain("popOutPortForwardPreview(url)");
    expect(body).not.toContain("localhost");
  });

  it("offers the port-forward list from the toast instead of leaving the page on its own", () => {
    expect(body).toContain('label: "Open port-forwards"');
    expect(body).toContain("?workload=portforwarding");
    // The only navigation is inside the toast button's handler.
    expect(body.match(/goto\(/g)).toHaveLength(1);
    expect(body.indexOf("goto(")).toBeGreaterThan(body.indexOf("onClick"));
  });
});
