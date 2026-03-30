import { describe, expect, it } from "vitest";
import {
  validateYamlSyntax,
  detectDuplicateKeys,
  checkIndentation,
  parseKubeconformOutput,
  kubeconformToDiagnostics,
} from "./yaml-lint";

// ---------------------------------------------------------------------------
// Helpers to simulate CodeMirror doc API
// ---------------------------------------------------------------------------

function makeDocHelpers(doc: string) {
  const lines = doc.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1; // +1 for newline
  }

  return {
    lineStart: (lineNo: number) => lineOffsets[lineNo - 1] ?? 0,
    lineLength: (pos: number) => {
      const idx = lineOffsets.findIndex((o, i) => {
        const next = lineOffsets[i + 1] ?? doc.length + 1;
        return pos >= o && pos < next;
      });
      return idx >= 0 ? lines[idx].length : 0;
    },
    totalLines: lines.length,
    docLength: doc.length,
  };
}

// ---------------------------------------------------------------------------
// validateYamlSyntax
// ---------------------------------------------------------------------------

describe("validateYamlSyntax", () => {
  it("returns empty for valid YAML", () => {
    const doc = "apiVersion: v1\nkind: Pod\n";
    const h = makeDocHelpers(doc);
    expect(validateYamlSyntax(doc, h.lineStart, h.lineLength, h.totalLines, h.docLength)).toEqual(
      [],
    );
  });

  it("returns empty for valid multi-document YAML", () => {
    const doc = "apiVersion: v1\nkind: Pod\n---\napiVersion: v1\nkind: Service\n";
    const h = makeDocHelpers(doc);
    expect(validateYamlSyntax(doc, h.lineStart, h.lineLength, h.totalLines, h.docLength)).toEqual(
      [],
    );
  });

  it("detects syntax error", () => {
    const doc = "key: value\n  nested: true\n another: [invalid\n";
    const h = makeDocHelpers(doc);
    const result = validateYamlSyntax(doc, h.lineStart, h.lineLength, h.totalLines, h.docLength);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].severity).toBe("error");
  });

  it("returns empty for blank document", () => {
    const doc = "   \n  \n";
    const h = makeDocHelpers(doc);
    expect(validateYamlSyntax(doc, h.lineStart, h.lineLength, h.totalLines, h.docLength)).toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// detectDuplicateKeys
// ---------------------------------------------------------------------------

describe("detectDuplicateKeys", () => {
  it("detects duplicate keys at root level", () => {
    const doc = "name: foo\nversion: 1\nname: bar\n";
    const h = makeDocHelpers(doc);
    const result = detectDuplicateKeys(doc, h.lineStart, h.lineLength);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
    expect(result[0].message).toContain('Duplicate key "name"');
    expect(result[0].message).toContain("first at line 1");
  });

  it("allows same key in different indent scopes", () => {
    const doc = "metadata:\n  name: foo\nspec:\n  name: bar\n";
    const h = makeDocHelpers(doc);
    expect(detectDuplicateKeys(doc, h.lineStart, h.lineLength)).toEqual([]);
  });

  it("resets scope on document separator", () => {
    const doc = "name: foo\n---\nname: bar\n";
    const h = makeDocHelpers(doc);
    expect(detectDuplicateKeys(doc, h.lineStart, h.lineLength)).toEqual([]);
  });

  it("allows same key at different nesting levels", () => {
    const doc = "name: root\nmetadata:\n  name: nested\n";
    const h = makeDocHelpers(doc);
    expect(detectDuplicateKeys(doc, h.lineStart, h.lineLength)).toEqual([]);
  });

  it("ignores comments and blank lines", () => {
    const doc = "name: foo\n# comment\n\nversion: 1\n";
    const h = makeDocHelpers(doc);
    expect(detectDuplicateKeys(doc, h.lineStart, h.lineLength)).toEqual([]);
  });

  it("detects duplicates inside nested scope", () => {
    const doc = "metadata:\n  name: foo\n  name: bar\n";
    const h = makeDocHelpers(doc);
    const result = detectDuplicateKeys(doc, h.lineStart, h.lineLength);
    expect(result).toHaveLength(1);
    expect(result[0].message).toContain('Duplicate key "name"');
  });
});

// ---------------------------------------------------------------------------
// checkIndentation
// ---------------------------------------------------------------------------

describe("checkIndentation", () => {
  it("reports tab indentation", () => {
    const doc = "name: foo\n\tvalue: bar\n";
    const h = makeDocHelpers(doc);
    const result = checkIndentation(doc, h.lineStart, h.lineLength);
    expect(result.some((d) => d.message.includes("Tabs are not allowed"))).toBe(true);
  });

  it("reports odd indentation", () => {
    const doc = "spec:\n   name: foo\n";
    const h = makeDocHelpers(doc);
    const result = checkIndentation(doc, h.lineStart, h.lineLength);
    expect(result.some((d) => d.message.includes("Odd indentation"))).toBe(true);
  });

  it("allows proper 2-space indentation", () => {
    const doc = "spec:\n  name: foo\n  containers:\n    - name: app\n";
    const h = makeDocHelpers(doc);
    expect(checkIndentation(doc, h.lineStart, h.lineLength)).toEqual([]);
  });

  it("does not warn about odd indentation on list items", () => {
    const doc = "items:\n   - name: foo\n";
    const h = makeDocHelpers(doc);
    const result = checkIndentation(doc, h.lineStart, h.lineLength);
    expect(result.filter((d) => d.message.includes("Odd indentation"))).toEqual([]);
  });

  it("ignores blank lines and comments", () => {
    const doc = "# comment\n\nname: foo\n";
    const h = makeDocHelpers(doc);
    expect(checkIndentation(doc, h.lineStart, h.lineLength)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseKubeconformOutput
// ---------------------------------------------------------------------------

describe("parseKubeconformOutput", () => {
  it("parses VALID result", () => {
    const output =
      '{"filename":"test.yaml","kind":"Deployment","name":"web","version":"apps/v1","status":"VALID","msg":""}';
    const result = parseKubeconformOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("VALID");
    expect(result[0].kind).toBe("Deployment");
  });

  it("parses INVALID result", () => {
    const output =
      '{"filename":"test.yaml","kind":"Deployment","name":"web","version":"apps/v1","status":"INVALID","msg":"spec.replicas: Invalid type. Expected: integer, given: string"}';
    const result = parseKubeconformOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("INVALID");
    expect(result[0].msg).toContain("spec.replicas");
  });

  it("parses multiple lines", () => {
    const output = [
      '{"filename":"a.yaml","kind":"Pod","name":"p","version":"v1","status":"VALID","msg":""}',
      '{"filename":"b.yaml","kind":"Foo","name":"f","version":"v1","status":"ERROR","msg":"could not find schema"}',
    ].join("\n");
    const result = parseKubeconformOutput(output);
    expect(result).toHaveLength(2);
  });

  it("skips non-JSON lines", () => {
    const output =
      "some warning\n" +
      '{"filename":"a.yaml","kind":"Pod","name":"p","version":"v1","status":"VALID","msg":""}';
    const result = parseKubeconformOutput(output);
    expect(result).toHaveLength(1);
  });

  it("returns empty for blank output", () => {
    expect(parseKubeconformOutput("")).toEqual([]);
    expect(parseKubeconformOutput("  \n  ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// kubeconformToDiagnostics
// ---------------------------------------------------------------------------

describe("kubeconformToDiagnostics", () => {
  it("skips VALID and SKIPPED results", () => {
    const results = [
      { filename: "", kind: "Pod", name: "p", version: "v1", status: "VALID" as const, msg: "" },
      { filename: "", kind: "Foo", name: "f", version: "", status: "SKIPPED" as const, msg: "" },
    ];
    const doc = "apiVersion: v1\nkind: Pod\n";
    const h = makeDocHelpers(doc);
    expect(kubeconformToDiagnostics(results, doc, h.lineStart, h.lineLength, h.docLength)).toEqual(
      [],
    );
  });

  it("creates diagnostic for INVALID result", () => {
    const results = [
      {
        filename: "",
        kind: "Deployment",
        name: "web",
        version: "apps/v1",
        status: "INVALID" as const,
        msg: "spec.replicas: Invalid type",
      },
    ];
    const doc = "apiVersion: apps/v1\nkind: Deployment\nspec:\n  replicas: bad\n";
    const h = makeDocHelpers(doc);
    const diags = kubeconformToDiagnostics(results, doc, h.lineStart, h.lineLength, h.docLength);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].message).toContain("[kubeconform]");
    expect(diags[0].message).toContain("spec.replicas");
  });

  it("locates field in document when possible", () => {
    const results = [
      {
        filename: "",
        kind: "Deployment",
        name: "web",
        version: "apps/v1",
        status: "INVALID" as const,
        msg: "spec.replicas: Invalid type",
      },
    ];
    const doc = "apiVersion: apps/v1\nkind: Deployment\nspec:\n  replicas: bad\n";
    const h = makeDocHelpers(doc);
    const diags = kubeconformToDiagnostics(results, doc, h.lineStart, h.lineLength, h.docLength);
    // Should point to line 4 (replicas)
    expect(diags[0].from).toBe(h.lineStart(4));
  });

  it("falls back to line 1 for unknown fields", () => {
    const results = [
      {
        filename: "",
        kind: "Pod",
        name: "p",
        version: "v1",
        status: "ERROR" as const,
        msg: "could not find schema for Pod",
      },
    ];
    const doc = "apiVersion: v1\nkind: Pod\n";
    const h = makeDocHelpers(doc);
    const diags = kubeconformToDiagnostics(results, doc, h.lineStart, h.lineLength, h.docLength);
    expect(diags).toHaveLength(1);
    expect(diags[0].from).toBe(0);
  });
});
