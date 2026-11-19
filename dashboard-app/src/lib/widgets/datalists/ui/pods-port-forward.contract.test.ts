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
    expect(body).toContain("const localPort = defaultLocalPort(firstPort);");
    expect(body).toMatch(/remotePort: firstPort,\s*localPort,/);
  });

  it("shows and opens the local port, not the container port", () => {
    expect(body).toContain(
      "`Port-forward started: localhost:${localPort} -> ${name}:${firstPort}`",
    );
    expect(body).toContain("popOutPortForwardPreview(`http://localhost:${localPort}`)");
    expect(body).not.toContain("http://localhost:${firstPort}");
  });
});
