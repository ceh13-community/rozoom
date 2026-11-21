import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";
import { createWorkbenchReveal } from "./workbench-reveal.svelte";

describe("createWorkbenchReveal", () => {
  it("changes the token after each opened tab, not after a failed open", async () => {
    let reveal!: ReturnType<typeof createWorkbenchReveal>;
    const tokens: Array<number | null> = [];
    const cleanup = $effect.root(() => {
      reveal = createWorkbenchReveal();
      $effect(() => {
        tokens.push(reveal.token);
      });
    });
    flushSync();
    expect(reveal.token).toBeNull();

    await reveal.after(Promise.resolve("tab"));
    flushSync();
    await reveal.after(Promise.reject(new Error("no pod"))).catch(() => undefined);
    flushSync();
    await reveal.after(undefined);
    flushSync();

    expect(tokens).toEqual([null, 1, 2]);
    cleanup();
  });

  it("returns what the open call returns", async () => {
    const reveal = createWorkbenchReveal();
    await expect(reveal.after(Promise.resolve(42))).resolves.toBe(42);
  });
});
