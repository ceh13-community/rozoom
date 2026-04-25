# Enterprise Readiness & Security Posture

Where ROZOOM stands today on enterprise / regulated-industry adoption,
and what is planned. Written for security reviewers, compliance teams,
and customers doing procurement.

Dates: current as of **2026-04-19**.

---

## Today — what's in place

### App architecture

- **Tauri v2 process isolation.** Frontend (WebView) cannot spawn system
  processes; every CLI call goes through the allowlisted sidecar
  capability system. See [`SECURITY.md`](../SECURITY.md).
- **Restrictive CSP.** `script-src 'self'`, `connect-src` restricted to
  127.0.0.1 / localhost. No remote script loading, no `eval`, no external
  HTTP from the WebView.
- **Bundled binaries only.** kubectl, helm, aws, gcloud, az, doctl,
  hcloud, oc, trivy and 11 others ship with the app. No system PATH use.
  Each binary is SHA256-pinned against upstream checksums at build time
  (`download-binaries.js`).
- **DevTools disabled** in production builds.

### Kubernetes-facing security

- **Comprehensive auth method detection** — OIDC exec plugins, AWS IAM,
  GKE / Azure exec, kubelogin, x509, bearer token, deprecated
  auth-provider. JWT expiry parsed from bearer tokens with countdown.
- **Exec-plugin Connect method** (Phase 7 / April 2026) — generates
  kubeconfig with no embedded secrets; tokens flow through
  `aws eks get-token`, `gke-gcloud-auth-plugin`, `kubelogin`, etc. This
  is the upstream Kubernetes recommendation for cluster access.
- **Credential risk scoring** on every cluster card — flags plaintext
  tokens, disabled TLS verification, deprecated auth-provider, and
  missing rotation with remediation hints.
- **Kubeconfig 0600 enforcement** — app fails hygiene check if group or
  other can read the file.
- **RBAC risk scanner** — detects dangerous verb+resource combinations
  (wildcards, escalate, bind, impersonate, pods/exec) per the K8s RBAC
  good-practices doc.
- **Pod Security Standards compliance** — checks pods against Baseline
  and Restricted PSS levels per spec.
- **insecure-skip-tls-verify** detection with warnings.
- **Preview + Test Connection** before saving a kubeconfig — users see
  exactly what YAML gets written to disk (secrets masked) and can
  validate against the real API server first.

### Data handling

- **No external telemetry** beyond optional Sentry. No Posthog, Mixpanel,
  GA, or vendor analytics.
- **All cloud API calls** go through bundled CLIs (aws/gcloud/az/etc).
  The WebView never reaches a cloud endpoint directly.
- **Local audit trail** — cluster add/remove/restore events timestamped
  locally (`audit-trail.ts`, 11 event types).

---

## Suitability matrix

| Audience                              | Status         | Notes                                                                  |
| ------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| Individual developer / OSS maintainer | ✅ ready       | Exceeds common free tools in hygiene coverage                          |
| Internal dev / platform team (SMB)    | ✅ ready       | CSP + bundled binaries + RBAC scanner cover the realistic threat model |
| Mid-market SaaS                       | 🟡 conditional | Sentry scrubbing required before vendor review (Phase 8.2)             |
| SOC 2 Type II                         | ❌ not ready   | Blocked by Phase 8.1, 8.2, 8.3, 8.5                                    |
| ISO 27001                             | ❌ not ready   | Blocked by Phase 8.1, 8.3, 8.5                                         |
| PCI-DSS 4.0                           | ❌ not ready   | Req 3 blocked by Phase 8.1                                             |
| HIPAA                                 | ❌ not ready   | §164.312(a)(2)(iv) blocked by Phase 8.1                                |
| FedRAMP Moderate                      | ❌ not ready   | SC-28, AU-9 blocked by 8.1, 8.3                                        |
| FedRAMP High / DoD IL4+               | ❌ far         | Also needs 8.11 (FIPS 140-3)                                           |
| Banking (DORA / SOX)                  | ❌ not ready   | Needs 8.1, 8.3, 8.10                                                   |

---

## Where we're heading — Phase 8

[ROADMAP.md Phase 8](../../ROADMAP.md#phase-8-enterprise-security-hardening)
enumerates 12 items. Ordered by compliance impact:

| #       | Item                                                                      | Unlocks                                                                         |
| ------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **8.1** | **Encrypted kubeconfig at rest** (Tauri Stronghold + OS keyring fallback) | **PCI-DSS req 3, HIPAA §164.312, SOC 2 CC6.1, ISO 27001 A.10.1, FedRAMP SC-28** |
| 8.2     | Sentry credential scrubbing (beforeSend hook)                             | GDPR Art. 32, SOC 2 CC6.7                                                       |
| 8.3     | HMAC-chained tamper-proof audit log                                       | SOC 2 CC7.3, ISO 27001 A.12.4.2, FedRAMP AU-9                                   |
| 8.4     | Enforce `readOnly` flag at kubectl-proxy layer                            | ISO 27001 A.9.4.1                                                               |
| 8.5     | Signed auto-update (Ed25519) with rollback                                | NIST SSDF PS.2, US EO 14028                                                     |
| 8.6     | cosign / sigstore for bundled binary verification                         | SLSA Level 3+                                                                   |
| 8.7     | Plugin web-worker sandbox with capability mediator                        | OWASP ASVS V14                                                                  |
| 8.8     | Corporate proxy + custom CA bundle support                                | Enterprise MITM inspectors                                                      |
| 8.9     | SIEM export (Splunk HEC, Loki, syslog TLS)                                | SOC 2 CC7.2                                                                     |
| 8.10    | App-level session lock                                                    | NIST 800-53 IA-11                                                               |
| 8.11    | FIPS 140-3 crypto mode (stretch)                                          | FedRAMP High, DoD IL4+                                                          |
| 8.12    | CycloneDX SBOM + SLSA provenance                                          | EU Cyber Resilience Act, US EO 14028                                            |

### 8.1 is the keystone

Shipping 8.1 alone unlocks **PCI-DSS + HIPAA + SOC 2** because they all
hinge on the same control: credentials must be encrypted at rest. The
roadmap entry has a complete design: Tauri Stronghold primary with OS
keyring (Secret Service / Keychain / DPAPI) fallback, unified
`CredentialVault` TypeScript interface, onboarding UX, 30-minute session
lock, passphrase rotation, BIP-39-style recovery phrase, migration plan
with 3-pass overwrite of plaintext, 14-day `.pre-vault-backup/` snapshot
for safety, and idempotent re-runs on interruption.

See [ROADMAP.md §8.1](../../ROADMAP.md#81-encrypted-kubeconfig-storage-at-rest)
for full specification.

### Realistic sequencing

1. **8.2 first** — cheap (one `beforeSend` regex set) and immediately
   lowers telemetry risk. No migration cost.
2. **8.1 next** — one focused PR unlocks the three biggest compliance
   frameworks. This is the largest single investment in Phase 8.
3. **8.3, 8.4, 8.5** — can ship in parallel.
4. **8.8** — unblocks adoption at large orgs behind SSL inspection
   proxies. Mostly plumbing, no crypto.
5. **8.6, 8.9, 8.10, 8.12** — enterprise polish, SIEM integrations.
6. **8.7** — must ship before the plugin marketplace goes live. Not
   urgent until then.
7. **8.11** — only if a US federal / defense deal enters pipeline.

---

## For reviewers asking specific questions

**"Where are credentials stored and how?"**
Today: plaintext YAML in `AppData/configs/<uuid>.yaml`, file mode 0600.
After 8.1: encrypted Stronghold snapshot or OS keyring entries, accessed
via passphrase or OS keyring ACL. Plaintext path remains as opt-in
escape hatch for CI with a persistent red banner in the UI.

**"What goes to Sentry / third parties?"**
Sentry only, and only if the user enables it via env. No analytics.
Today Sentry receives raw exceptions which may contain kubeconfig
paths or stderr snippets. After 8.2, a `beforeSend` regex scrub strips
`token:`, `client-key-data`, `--oidc-client-secret=`, Authorization
headers, and kubeconfig absolute paths before upload.

**"How do you verify bundled binaries are what upstream published?"**
Today: SHA256 checksums from the upstream GitHub release, pinned at
build time. After 8.6: cosign verification against the sigstore
public-good Rekor transparency log for upstreams that sign (kubectl,
helm, trivy, velero).

**"Can a malicious plugin exfiltrate kubeconfigs?"**
Today: yes, if a marketplace plugin were to ship code. Current plugins
are static manifests (no code execution) so the practical risk is zero,
but the moment we enable code plugins the sandbox is needed. After 8.7:
plugins run in a Web Worker with a capability-mediated message API; no
direct access to kubeconfigs, stores, or network.

**"What happens if someone edits the local audit log?"**
Today: no detection. After 8.3: HMAC chain over entries means any
edit / delete is detected on next startup; operator gets a red banner.

**"Can you forward events to our SIEM?"**
Not today. Phase 8.9 adds native Splunk HEC, Loki push, syslog
RFC 5424 over TCP+TLS, and plain JSONL tail forwarders.

---

## Reporting security issues

See [`SECURITY.md`](../SECURITY.md). Email: udawpk@gmail.com. Do **not**
open public GitHub issues for vulnerabilities.
