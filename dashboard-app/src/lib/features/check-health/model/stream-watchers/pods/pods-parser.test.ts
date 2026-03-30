import { describe, it, expect } from "vitest";
import { parsePodJsonLine } from "./pods-parser";

describe("parsePodJsonLine", () => {
  it("should parse a valid ADDED event with required fields", () => {
    const line = JSON.stringify({
      type: "ADDED",
      object: {
        metadata: { name: "my-pod-123" },
        spec: {},
        status: {},
      },
    });

    const result = parsePodJsonLine(line);

    expect(result).toMatchObject({
      kind: "pod",
      event: {
        type: "ADDED",
        object: {
          metadata: { name: "my-pod-123" },
          spec: {},
          status: {},
        },
      },
      shouldEmit: true,
    });
  });

  it("should parse a valid MODIFIED event", () => {
    const line = JSON.stringify({
      type: "MODIFIED",
      object: {
        metadata: { name: "updated-pod" },
        spec: { containers: [] },
      },
    });

    const result = parsePodJsonLine(line);

    expect(result?.kind).toBe("pod");
    expect(result?.event.type).toBe("MODIFIED");
    expect(result?.event.object.metadata?.name).toBe("updated-pod");
  });

  it("should parse a valid DELETED event", () => {
    const line = JSON.stringify({
      type: "DELETED",
      object: {
        metadata: { name: "deleted-pod", namespace: "default" },
      },
    });

    const result = parsePodJsonLine(line);

    expect(result?.kind).toBe("pod");
    expect(result?.event.type).toBe("DELETED");
    expect(result?.event.object.metadata?.name).toBe("deleted-pod");
  });

  it("should return null when JSON is invalid", () => {
    const line = "this is not json {";

    const result = parsePodJsonLine(line);

    expect(result).toBeNull();
  });

  it("should return null when 'type' field is missing", () => {
    const line = JSON.stringify({
      object: {
        metadata: { name: "pod-without-type" },
      },
    });

    const result = parsePodJsonLine(line);

    expect(result).toBeNull();
  });

  it("should return null when metadata.name is missing", () => {
    const line = JSON.stringify({
      type: "ADDED",
      object: {
        metadata: {},
      },
    });

    const result = parsePodJsonLine(line);

    expect(result).toBeNull();
  });

  it("should return null when metadata is missing entirely", () => {
    const line = JSON.stringify({
      type: "MODIFIED",
      object: {
        spec: {},
      },
    });

    const result = parsePodJsonLine(line);

    expect(result).toBeNull();
  });

  it("should return null when input is 'null' string", () => {
    const line = "null";

    const result = parsePodJsonLine(line);

    expect(result).toBeNull();
  });

  it("should return null when input is empty object string", () => {
    const line = "{}";

    const result = parsePodJsonLine(line);

    expect(result).toBeNull();
  });

  it("should return null when input is empty string", () => {
    const line = "";

    const result = parsePodJsonLine(line);

    expect(result).toBeNull();
  });
});
