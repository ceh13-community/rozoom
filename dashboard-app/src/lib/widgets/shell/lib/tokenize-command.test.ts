import { describe, expect, it } from "vitest";
import { tokenizeCommand } from "./tokenize-command";

function tokens(input: string): string[] {
  const r = tokenizeCommand(input);
  if (!r.ok) throw new Error(r.error);
  return r.tokens;
}

describe("tokenizeCommand", () => {
  it("splits plain whitespace-separated tokens", () => {
    expect(tokens("kubectl get pods")).toEqual(["kubectl", "get", "pods"]);
  });

  it("treats any whitespace as separator (spaces, tabs, newlines)", () => {
    expect(tokens("kubectl\tget\n  pods")).toEqual(["kubectl", "get", "pods"]);
  });

  it("preserves single-quoted content as literal", () => {
    expect(tokens("helm --set 'args[0]=foo bar'")).toEqual(["helm", "--set", "args[0]=foo bar"]);
  });

  it("preserves commas inside quoted values (the helm --set case)", () => {
    expect(
      tokens("helm --set 'args[0]=--kubelet-preferred-address-types=InternalIP,ExternalIP'"),
    ).toEqual(["helm", "--set", "args[0]=--kubelet-preferred-address-types=InternalIP,ExternalIP"]);
  });

  it("double-quoted content preserves spaces and applies limited escapes", () => {
    expect(tokens('echo "hello world"')).toEqual(["echo", "hello world"]);
    expect(tokens('echo "say \\"hi\\""')).toEqual(["echo", 'say "hi"']);
    expect(tokens('echo "\\\\"')).toEqual(["echo", "\\"]);
  });

  it("single-quoted content does NOT interpret backslash escapes", () => {
    expect(tokens("echo 'path\\file'")).toEqual(["echo", "path\\file"]);
  });

  it("backslash-newline is a line continuation (joins lines)", () => {
    const cmd = "helm upgrade metrics-server \\\n  -n kube-system \\\n  --reuse-values";
    expect(tokens(cmd)).toEqual([
      "helm",
      "upgrade",
      "metrics-server",
      "-n",
      "kube-system",
      "--reuse-values",
    ]);
  });

  it("backslash-newline inside double quotes still continues", () => {
    expect(tokens('echo "foo\\\nbar"')).toEqual(["echo", "foobar"]);
  });

  it("bare backslash escapes the next char outside quotes", () => {
    expect(tokens("echo foo\\ bar")).toEqual(["echo", "foo bar"]);
    expect(tokens("echo a\\,b")).toEqual(["echo", "a,b"]);
  });

  it("comments start at # and are stripped to end of line", () => {
    expect(tokens("kubectl get pods # show all")).toEqual(["kubectl", "get", "pods"]);
    expect(tokens("# only a comment")).toEqual([]);
    expect(tokens("kubectl get pods\n# second line comment\nkubectl top nodes")).toEqual([
      "kubectl",
      "get",
      "pods",
      "kubectl",
      "top",
      "nodes",
    ]);
  });

  it("# inside a token is literal, not a comment", () => {
    expect(tokens("echo foo#bar")).toEqual(["echo", "foo#bar"]);
    expect(tokens("echo '#literal'")).toEqual(["echo", "#literal"]);
  });

  it("handles an empty / whitespace-only input", () => {
    expect(tokens("")).toEqual([]);
    expect(tokens("   \n\t  ")).toEqual([]);
  });

  it("rejects unterminated single quote", () => {
    const r = tokenizeCommand("echo 'hello");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/single/i);
  });

  it("rejects unterminated double quote", () => {
    const r = tokenizeCommand('echo "hello');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/double/i);
  });

  it("rejects trailing backslash at end of input", () => {
    const r = tokenizeCommand("echo foo \\");
    expect(r.ok).toBe(false);
  });

  it("tolerates trailing spaces/tabs between backslash and newline", () => {
    // Chat UIs, Markdown renders, and rich-text clipboards often leave
    // invisible whitespace between the `\` and the newline. Strict
    // POSIX would treat that as "escape space" (literal space) and
    // break the line split. Be forgiving.
    const input = "helm upgrade foo bar \\    \n    -n ns \\\t\t\n    --set 'a=b'";
    expect(tokens(input)).toEqual(["helm", "upgrade", "foo", "bar", "-n", "ns", "--set", "a=b"]);
  });

  it("normalises CRLF line endings so pasted Windows text round-trips", () => {
    const crlf = "helm upgrade foo bar \\\r\n    -n kube-system";
    expect(tokens(crlf)).toEqual(["helm", "upgrade", "foo", "bar", "-n", "kube-system"]);
  });

  it("normalises bare CR (old Mac / weird clipboards) as well", () => {
    const cr = "kubectl\rget\rpods";
    expect(tokens(cr)).toEqual(["kubectl", "get", "pods"]);
  });

  it("real-world case: the helm command that prompted this PR", () => {
    // Backslashes inside single quotes stay literal (POSIX) - that's
    // the whole point here: helm's --set interprets bare commas as
    // separators, so the user escapes them with \, ; inside single
    // quotes the backslash reaches helm verbatim and helm unescapes.
    const cmd = `helm upgrade metrics-server metrics-server/metrics-server \\
  -n kube-system \\
  --reuse-values \\
  --set 'args[0]=--kubelet-insecure-tls' \\
  --set 'args[1]=--kubelet-preferred-address-types=InternalIP\\,ExternalIP\\,Hostname'`;
    expect(tokens(cmd)).toEqual([
      "helm",
      "upgrade",
      "metrics-server",
      "metrics-server/metrics-server",
      "-n",
      "kube-system",
      "--reuse-values",
      "--set",
      "args[0]=--kubelet-insecure-tls",
      "--set",
      "args[1]=--kubelet-preferred-address-types=InternalIP\\,ExternalIP\\,Hostname",
    ]);
  });
});
