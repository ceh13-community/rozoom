import { describe, expect, it } from "vitest";
import type { Breadcrumb, Event } from "@sentry/sveltekit";
import { scrubString, scrubValue, scrubEvent, scrubBreadcrumb, SCRUB_RULES } from "./sentry-scrub";

describe("scrubString", () => {
  it("redacts bearer token in kubeconfig YAML", () => {
    const input = "users:\n- name: u\n  user:\n    token: xoxb-abc123.def";
    expect(scrubString(input)).toBe("users:\n- name: u\n  user:\n    token: [REDACTED]");
  });

  it("redacts client-key-data", () => {
    const input = "client-key-data: LS0tLS1CRUdJTi==";
    expect(scrubString(input)).toBe("client-key-data: [REDACTED]");
  });

  it("redacts client-certificate-data and CA data", () => {
    expect(scrubString("client-certificate-data: LS0tLS1")).toBe(
      "client-certificate-data: [REDACTED]",
    );
    expect(scrubString("certificate-authority-data: aGVsbG8=")).toBe(
      "certificate-authority-data: [REDACTED]",
    );
  });

  it("redacts --oidc-client-secret CLI arg", () => {
    const input =
      "kubelogin get-token --oidc-issuer-url=https://idp --oidc-client-secret=s3cret --oidc-client-id=app";
    const out = scrubString(input);
    expect(out).toContain("--oidc-client-secret=[REDACTED]");
    expect(out).toContain("--oidc-issuer-url=https://idp");
    expect(out).toContain("--oidc-client-id=app");
  });

  it("redacts Authorization: Bearer header (whole value after colon)", () => {
    const out = scrubString("Authorization: Bearer eyJhbGciOi.foo.bar");
    expect(out).toBe("Authorization: [REDACTED]");
    expect(out).not.toContain("eyJ");
  });

  it("redacts bare Bearer token without Authorization: prefix", () => {
    const out = scrubString("sent header Bearer xoxb.abc.def123");
    expect(out).toContain("Bearer [REDACTED]");
    expect(out).not.toContain("xoxb.abc.def123");
  });

  it("redacts non-bearer Authorization header values", () => {
    expect(scrubString("authorization: Basic dXNlcjpwYXNz")).toBe("authorization: [REDACTED]");
  });

  it("redacts password= and password: fields", () => {
    expect(scrubString("password=swordfish")).toBe("password=[REDACTED]");
    expect(scrubString("password: swordfish")).toBe("password: [REDACTED]");
  });

  it("redacts bare JWT tokens", () => {
    const input = "stderr: unauthorized (eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.abc123xyz)";
    const out = scrubString(input);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("normalises POSIX kubeconfig path", () => {
    expect(
      scrubString("failed to read /home/alice/.local/share/ROZOOM/configs/abc-123.yaml"),
    ).toContain("[kubeconfig-path]");
  });

  it("normalises macOS kubeconfig path", () => {
    expect(scrubString("/Users/bob/Library/Application Support/ROZOOM/configs/xyz.yaml")).toContain(
      "[kubeconfig-path]",
    );
  });

  it("normalises Windows kubeconfig path", () => {
    const input = "C:\\Users\\carol\\AppData\\Roaming\\ROZOOM\\configs\\123.yaml broke";
    const out = scrubString(input);
    expect(out).toContain("[kubeconfig-path]");
    expect(out).not.toContain("carol");
  });

  it("is idempotent", () => {
    const input = "token: secret\nclient-key-data: priv\n--oidc-client-secret=xyz";
    const once = scrubString(input);
    const twice = scrubString(once);
    expect(twice).toBe(once);
  });

  it("leaves safe text alone", () => {
    const input = "Cluster prod-eks has 5 nodes ready. API server at https://10.0.0.1:6443";
    expect(scrubString(input)).toBe(input);
  });

  it("preserves server URLs (not secret)", () => {
    expect(scrubString("https://EABC.gr7.us-east-1.eks.amazonaws.com")).toContain(
      "eks.amazonaws.com",
    );
  });

  it("redacts multiple secrets in one payload", () => {
    const input = `stderr: error connecting to server
Authorization: Bearer tok1abcdef
loaded config from /home/user/.kube/config
token: xyz789`;
    const out = scrubString(input);
    expect(out).toContain("Authorization: [REDACTED]");
    expect(out).toContain("token: [REDACTED]");
    expect(out).toContain("[kubeconfig-path]");
    expect(out).not.toContain("tok1abcdef");
    expect(out).not.toContain("xyz789");
  });

  it("handles empty string", () => {
    expect(scrubString("")).toBe("");
  });
});

describe("scrubValue", () => {
  it("scrubs strings at root", () => {
    expect(scrubValue("token: abc")).toBe("token: [REDACTED]");
  });

  it("walks object properties", () => {
    const input = { stderr: "token: abc", code: 1 };
    const out = scrubValue(input);
    expect(out.stderr).toBe("token: [REDACTED]");
    expect(out.code).toBe(1);
  });

  it("walks nested arrays", () => {
    const input = { args: ["--oidc-client-secret=xyz", "--flag"] };
    const out = scrubValue(input);
    expect(out.args[0]).toBe("--oidc-client-secret=[REDACTED]");
    expect(out.args[1]).toBe("--flag");
  });

  it("preserves non-string primitives", () => {
    const input = { n: 42, b: true, nil: null, u: undefined };
    expect(scrubValue(input)).toEqual(input);
  });

  it("bounds recursion depth", () => {
    let deep: Record<string, unknown> = { token: "abc123" };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    expect(() => scrubValue(deep)).not.toThrow();
  });
});

describe("scrubEvent", () => {
  it("scrubs message", () => {
    const ev: Event = { message: "token: abc" };
    const out = scrubEvent(ev);
    expect(out?.message).toBe("token: [REDACTED]");
  });

  it("scrubs exception value", () => {
    const ev: Event = {
      exception: {
        values: [{ type: "Error", value: "client-key-data: LS0tLS1" }],
      },
    };
    const out = scrubEvent(ev);
    expect(out?.exception?.values?.[0].value).toBe("client-key-data: [REDACTED]");
  });

  it("scrubs stacktrace frame vars and context", () => {
    const ev: Event = {
      exception: {
        values: [
          {
            type: "Error",
            value: "bad",
            stacktrace: {
              frames: [
                {
                  filename: "foo.ts",
                  vars: { kubeconfig: "token: abc" },
                  pre_context: ["line with token: x"],
                  context_line: "Authorization: Bearer tokabc",
                  post_context: ["safe line"],
                },
              ],
            },
          },
        ],
      },
    };
    const out = scrubEvent(ev);
    const frame = out?.exception?.values?.[0].stacktrace?.frames?.[0];
    expect(frame?.vars?.kubeconfig).toBe("token: [REDACTED]");
    expect(frame?.pre_context?.[0]).toBe("line with token: [REDACTED]");
    expect(frame?.context_line).toBe("Authorization: [REDACTED]");
    expect(frame?.post_context?.[0]).toBe("safe line");
  });

  it("scrubs breadcrumbs", () => {
    const ev: Event = {
      breadcrumbs: [
        { category: "http", message: "Authorization: Bearer abcdef", data: { url: "/x" } },
      ],
    };
    const out = scrubEvent(ev);
    expect(out?.breadcrumbs?.[0].message).toBe("Authorization: [REDACTED]");
  });

  it("scrubs request headers", () => {
    const ev: Event = {
      request: {
        headers: { Authorization: "Bearer abc", "X-Safe": "ok" },
      },
    };
    const out = scrubEvent(ev);
    expect(out?.request?.headers).toBeDefined();
    const headers = out?.request?.headers as Record<string, string>;
    // value inside object - scrubString applied to each string
    expect(headers.Authorization).not.toContain("abc");
    expect(headers["X-Safe"]).toBe("ok");
  });

  it("scrubs extra, contexts, tags", () => {
    const ev: Event = {
      extra: { stderr: "token: abc" },
      contexts: { runtime: { name: "node", version: "token: abc" } },
      tags: { server: "password: secret" },
    };
    const out = scrubEvent(ev);
    expect((out?.extra as Record<string, string>).stderr).toBe("token: [REDACTED]");
    const runtime = out?.contexts?.runtime as Record<string, string>;
    expect(runtime.version).toBe("token: [REDACTED]");
    expect((out?.tags as Record<string, string>).server).toBe("password: [REDACTED]");
  });

  it("is idempotent on events", () => {
    const ev: Event = { message: "token: abc" };
    const a = scrubEvent(ev);
    const b = scrubEvent(a as Event);
    expect(b?.message).toBe(a?.message);
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs message and data", () => {
    const crumb: Breadcrumb = {
      category: "fetch",
      message: "GET https://api - Authorization: Bearer abc",
      data: { headers: { Authorization: "Bearer abc" } },
    };
    const out = scrubBreadcrumb(crumb);
    expect(out.message).not.toContain("Bearer abc");
    expect(out.message).toContain("[REDACTED]");
    const headers = (out.data as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).not.toContain("abc");
  });

  it("preserves crumbs with no sensitive data", () => {
    const crumb: Breadcrumb = { category: "navigation", message: "goto /dashboard" };
    expect(scrubBreadcrumb(crumb).message).toBe("goto /dashboard");
  });
});

describe("SCRUB_RULES invariants", () => {
  it("all rules have a name and pattern", () => {
    for (const r of SCRUB_RULES) {
      expect(r.name).toBeTruthy();
      expect(r.pattern).toBeInstanceOf(RegExp);
      expect(r.pattern.flags).toContain("g");
    }
  });

  it("no rule names duplicated", () => {
    const names = SCRUB_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
