import { describe, expect, it } from "vitest";
import { redactSecrets } from "./log-redaction";

// Fixture mirrors the real tauri_plugin_log line format
// ([date][time][LEVEL][target] message) with the secret shapes Rozoom handles.
const BEARER = "sha256~Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg";
const JWT =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.eyJpc3MiOiJrdWJlcm5ldGVzL3NlcnZpY2VhY2NvdW50In0.MEUCIQDxyz1234567890abcdefghijklmnop";
const CERT_DATA =
  "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUM1ekNDQWMrZ0F3SUJBZ0lCQURBTkJna3Foa2lHOXcwQkFRc0ZBREFWTVJNd0VRWURWUVFERXdwcmRXSmwK";
const FIXTURE = [
  `[2026-08-29][10:12:01][INFO][webview:connect] request headers: {"Authorization":"Bearer ${BEARER}","Accept":"application/json"}`,
  `[2026-08-29][10:12:01][DEBUG][webview:kubeconfig] users: [{name: admin, user: {token: ${JWT}}}]`,
  `[2026-08-29][10:12:02][DEBUG][webview:kubeconfig] clusters: [{cluster: {certificate-authority-data: ${CERT_DATA}, server: https://10.0.0.1:6443}}]`,
  `[2026-08-29][10:12:02][DEBUG][webview:kubeconfig] client-key-data: ${CERT_DATA}`,
  `[2026-08-29][10:12:03][ERROR][webview:kubectl] kubectl command failed: code=1 args="--kubeconfig /home/u/.kube/config --token=${BEARER} get pods"`,
  `[2026-08-29][10:12:03][WARN][webview:auth] basic auth for https://registry: password: "hunter2-not-a-real-one"`,
  `[2026-08-29][10:12:04][DEBUG][webview:tls] -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----`,
  `[2026-08-29][10:12:05][ERROR][webview:kubectl] kubectl command failed: cluster=13b66118-19cc-4389-a28d-93f74215dc8e code=1 args="--kubeconfig /home/geek/.local/share/com.rozoom.k8s-linter-ide/configs/13b66118.yaml get pods -n kube-system"`,
].join("\n");

describe("redactSecrets", () => {
  it("removes every secret shape from the fixture", () => {
    const out = redactSecrets(FIXTURE);
    for (const secret of [BEARER, JWT, CERT_DATA, "hunter2-not-a-real-one", "MIIEowIBAAKCAQEA"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("keeps the diagnostic context around the secrets", () => {
    const out = redactSecrets(FIXTURE);
    expect(out).toContain('"Authorization":"Bearer [REDACTED]"');
    expect(out).toContain("server: https://10.0.0.1:6443");
    expect(out).toContain("--token=[REDACTED]");
    expect(out).toContain("password: [REDACTED]");
    expect(out).toContain("-----BEGIN [REDACTED]-----");
    // Cluster ids, paths and kubectl args without secrets are untouched.
    expect(out).toContain(
      'cluster=13b66118-19cc-4389-a28d-93f74215dc8e code=1 args="--kubeconfig /home/geek/.local/share/com.rozoom.k8s-linter-ide/configs/13b66118.yaml get pods -n kube-system"',
    );
  });

  it("is a no-op on lines without secrets", () => {
    const line =
      "[2026-07-30][09:01:38][DEBUG][tauri_plugin_shell::process] Creating sidecar /usr/bin/rozoom-kubectl";
    expect(redactSecrets(line)).toBe(line);
  });

  it("masks a bare JWT and a bare long base64 blob", () => {
    expect(redactSecrets(`saw ${JWT} in response`)).toBe("saw [REDACTED] in response");
    expect(redactSecrets(`data=${CERT_DATA}`)).toBe("data=[REDACTED] base64");
  });
});
