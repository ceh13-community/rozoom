import { describe, expect, it } from "vitest";
import {
  buildPodAttachArgs,
  buildPodOutputFollowArgs,
  containerUsesTty,
  isAttachBannerLine,
} from "./pod-shell";

const pod = (tty?: boolean) => ({
  metadata: { name: "web", namespace: "shop" },
  spec: { containers: [{ name: "app", tty }] },
});

// With -i -t and no terminal, kubectl attach failed ("Unable to use a TTY") or hung,
// and the typed text never reached the process.
describe("read-only pod attach", () => {
  it("attaches without stdin or a tty", () => {
    expect(buildPodAttachArgs(pod() as never)).toEqual([
      "attach",
      "--namespace",
      "shop",
      "-c",
      "app",
      "web",
    ]);
  });

  it("follows the container log from now on for a tty container", () => {
    expect(containerUsesTty(pod(true) as never)).toBe(true);
    expect(containerUsesTty(pod() as never)).toBe(false);
    expect(buildPodOutputFollowArgs(pod(true) as never)).toEqual([
      "logs",
      "--follow",
      "--tail=0",
      "--namespace",
      "shop",
      "-c",
      "app",
      "web",
    ]);
  });

  it("recognises the interactive banner kubectl prints", () => {
    expect(
      isAttachBannerLine(
        "All commands and output from this session will be recorded in container logs, including credentials",
      ),
    ).toBe(true);
    expect(isAttachBannerLine("If you don't see a command prompt, try pressing enter.")).toBe(true);
    expect(isAttachBannerLine("64 bytes from 127.0.0.1: seq=1 ttl=64")).toBe(false);
  });
});
