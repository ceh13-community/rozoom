import { describe, expect, it } from "vitest";
import { formatCommandLine } from "$shared/lib/format-command-line";
import { parseCliCommand } from "./parse-cli-command";
import { tokenizeCommand } from "./tokenize-command";

describe("parseCliCommand", () => {
  it("runs a bundled tool with its arguments", () => {
    expect(parseCliCommand("kubectl get pods -A")).toEqual({
      kind: "cli",
      tool: "kubectl",
      args: ["get", "pods", "-A"],
    });
  });

  it("sends other commands to the shell", () => {
    expect(parseCliCommand("ls -la | wc -l")).toEqual({ kind: "shell" });
    expect(parseCliCommand("# just a comment")).toEqual({ kind: "shell" });
  });

  it("does not treat object prototype keys as tools", () => {
    expect(parseCliCommand("constructor --help")).toEqual({ kind: "shell" });
  });

  it.each([
    ["an unbalanced single quote", "kubectl describe roles it's"],
    ["an unbalanced double quote", 'echo "open'],
    ["a trailing backslash", "kubectl describe clusterroles name\\"],
  ])("refuses a command with %s", (_label, command) => {
    expect(parseCliCommand(command).kind).toBe("invalid");
  });
});

describe("formatCommandLine", () => {
  it("leaves plain arguments readable", () => {
    expect(formatCommandLine(["kubectl", "describe", "pod", "-n", "prod", "--", "api-0"])).toBe(
      "kubectl describe pod -n prod -- api-0",
    );
  });

  it.each([
    "a;touch marker;#'",
    "ends-with-backslash\\",
    "$(touch marker)",
    "`touch marker`",
    "two words",
    'double"quote',
    "#comment",
    "--all",
    "",
  ])("tokenizes back to the same arguments for %j", (name) => {
    const argv = ["kubectl", "describe", "roles", "--", name];
    expect(tokenizeCommand(formatCommandLine(argv))).toEqual({ ok: true, tokens: argv });
  });
});
