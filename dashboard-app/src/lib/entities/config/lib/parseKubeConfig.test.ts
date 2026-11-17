import { beforeEach, describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logError,
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

import { parseKubeconfigText } from "./parseKubeConfig";

// Bootstrap-token shape: short enough that js-yaml prints it whole in the snippet.
// Longer tokens are cut at about 79 columns, so only their head leaks.
const TOKEN = "dnlm42.0123456789abcdef";

// The unclosed flow sequence on the last line breaks the parse right below the token,
// so js-yaml's source snippet in `message` covers the token line.
const BROKEN_KUBECONFIG = [
  "apiVersion: v1",
  "kind: Config",
  "users:",
  "- name: admin",
  "  user:",
  `    token: ${TOKEN}`,
  "    client-key-data: [unclosed",
].join("\n");

function loggedText(): string {
  return logError.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("parseKubeconfigText invalid YAML logging", () => {
  beforeEach(() => {
    logError.mockClear();
  });

  it("does not write kubeconfig content to the log", async () => {
    await parseKubeconfigText(BROKEN_KUBECONFIG).catch(() => undefined);

    expect(logError).toHaveBeenCalled();
    expect(loggedText()).not.toContain(TOKEN);
    expect(loggedText()).not.toContain("dnlm42");
  });

  it("still says what is wrong and where", async () => {
    await parseKubeconfigText(BROKEN_KUBECONFIG).catch(() => undefined);

    expect(loggedText()).toMatch(/Invalid YAML format: .+ at line \d+, column \d+/);
  });
});
