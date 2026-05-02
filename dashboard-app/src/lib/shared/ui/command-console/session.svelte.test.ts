import { describe, expect, it } from "vitest";
import { createConsoleSession } from "./session.svelte";

describe("ConsoleSession", () => {
  it("starts idle with empty output", () => {
    const session = createConsoleSession();
    expect(session.status).toBe("idle");
    expect(session.output).toBe("");
    expect(session.expanded).toBe(false);
    expect(session.dismissed).toBe(false);
    expect(session.isRunning).toBe(false);
    expect(session.signal).toBeUndefined();
  });

  it("dismiss hides the console but keeps the transcript until the next run", () => {
    const session = createConsoleSession();
    session.start();
    session.append("some output");
    session.succeed();
    expect(session.dismissed).toBe(false);

    session.dismiss();
    expect(session.dismissed).toBe(true);
    expect(session.expanded).toBe(false);
    // transcript itself is retained so consumers can still inspect it
    expect(session.output).toContain("some output");
  });

  it("start() clears a prior dismissal so the console surfaces again", () => {
    const session = createConsoleSession();
    session.start();
    session.succeed();
    session.dismiss();
    expect(session.dismissed).toBe(true);

    session.start();
    expect(session.dismissed).toBe(false);
    expect(session.output).toBe("");
    expect(session.expanded).toBe(true);
  });

  it("start() clears output, arms abort signal, auto-expands", () => {
    const session = createConsoleSession();
    session.append("stale data");
    session.start();
    expect(session.status).toBe("running");
    expect(session.isRunning).toBe(true);
    expect(session.output).toBe("");
    expect(session.expanded).toBe(true);
    expect(session.signal).toBeDefined();
    expect(session.signal?.aborted).toBe(false);
  });

  it("append adds a trailing newline when missing", () => {
    const session = createConsoleSession();
    session.append("one");
    session.append("two\n");
    session.append("three");
    expect(session.output).toBe("one\ntwo\nthree\n");
  });

  it("append ignores empty chunks", () => {
    const session = createConsoleSession();
    session.append("line\n");
    session.append("");
    expect(session.output).toBe("line\n");
  });

  it("succeed and fail are terminal states that do not abort the signal", () => {
    const s1 = createConsoleSession();
    s1.start();
    s1.succeed();
    expect(s1.status).toBe("ok");
    expect(s1.signal?.aborted).toBe(false);

    const s2 = createConsoleSession();
    s2.start();
    s2.fail();
    expect(s2.status).toBe("fail");
    expect(s2.signal?.aborted).toBe(false);
  });

  it("cancel fires the abort signal so in-flight runners can bail", () => {
    const session = createConsoleSession();
    session.start();
    const signal = session.signal;
    expect(signal?.aborted).toBe(false);
    session.cancel();
    expect(signal?.aborted).toBe(true);
    expect(session.status).toBe("canceled");
  });

  it("toggleExpanded flips the flag", () => {
    const session = createConsoleSession();
    session.setExpanded(true);
    expect(session.expanded).toBe(true);
    session.toggleExpanded();
    expect(session.expanded).toBe(false);
  });

  it("reset returns every field to initial state", () => {
    const session = createConsoleSession();
    session.start();
    session.append("noise");
    session.succeed();
    session.setExpanded(true);
    session.dismiss();

    session.reset();
    expect(session.status).toBe("idle");
    expect(session.output).toBe("");
    expect(session.expanded).toBe(false);
    expect(session.dismissed).toBe(false);
    expect(session.signal).toBeUndefined();
  });
});
