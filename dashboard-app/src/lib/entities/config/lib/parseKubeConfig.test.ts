import { beforeEach, describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logError,
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

import { formatYamlError, parseKubeconfigText } from "./parseKubeConfig";

// Bootstrap-token shape: short enough that js-yaml prints it whole in the snippet.
// Longer tokens are cut at about 79 columns, so only their head leaks.
const TOKEN = "dnlm42.0123456789abcdef";

const kubeconfigWithUserLine = (line: string) =>
  [
    "apiVersion: v1",
    "kind: Config",
    "users:",
    "- name: admin",
    "  user:",
    `    token: ${TOKEN}`,
    line,
  ].join("\n");

// Each case breaks the parse on or right below a secret. `snippet`: the unclosed flow
// sequence puts the token line into js-yaml's source snippet. `alias` and `tag`: js-yaml
// quotes an unquoted value starting with * or ! in `reason` itself.
const CASES: Array<[string, string, string[]]> = [
  ["snippet", kubeconfigWithUserLine("    client-key-data: [unclosed"), [TOKEN, "dnlm42"]],
  ["alias", kubeconfigWithUserLine("    password: *S3cretPass"), ["S3cretPass", TOKEN]],
  ["tag", kubeconfigWithUserLine("    password: !S3cretTag value"), ["S3cretTag", TOKEN]],
];

function loggedText(): string {
  return logError.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("parseKubeconfigText invalid YAML logging", () => {
  beforeEach(() => {
    logError.mockClear();
  });

  it.each(CASES)("does not write kubeconfig content to the log (%s)", async (_, text, secrets) => {
    await parseKubeconfigText(text).catch(() => undefined);

    expect(logError).toHaveBeenCalled();
    for (const secret of secrets) expect(loggedText()).not.toContain(secret);
  });

  it.each(CASES)("still says where the error is (%s)", async (_, text) => {
    await parseKubeconfigText(text).catch(() => undefined);

    expect(loggedText()).toMatch(
      /^Invalid YAML format at line \d+, column \d+ \(YAMLException\)$/m,
    );
  });

  it("writes a line for a multi-document stream, which js-yaml reports without a position", async () => {
    const twoDocuments = `${kubeconfigWithUserLine("    username: admin")}\n---\nkind: Config\n`;

    await parseKubeconfigText(twoDocuments).catch(() => undefined);

    expect(loggedText()).toMatch(/^Invalid YAML format \(YAMLException\)$/m);
    expect(loggedText()).not.toContain(TOKEN);
  });
});

describe("formatYamlError", () => {
  it("names a non-YAML error without its message", () => {
    expect(formatYamlError(new TypeError(`bad ${TOKEN}`))).toBe("Invalid YAML format (TypeError)");
  });

  it("handles a thrown non-error", () => {
    expect(formatYamlError(TOKEN)).toBe("Invalid YAML format (unknown error)");
  });
});
