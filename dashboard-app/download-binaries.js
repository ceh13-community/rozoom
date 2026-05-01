#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import path from "path";
import https from "https";
import os from "os";
import process from "process";
import crypto from "crypto";
import extractZip from "extract-zip";
import console from "console";

// IMPORTANT: make all paths absolute (extract-zip requires absolute dir)
const PROJECT_ROOT = process.cwd();
const TARGET_DIR = path.resolve(PROJECT_ROOT, "src-tauri/binaries");

// Small local manifest to support caching/skipping downloads safely
const MANIFEST_PATH = path.join(TARGET_DIR, ".install-manifest.json");
const STATIC_MANIFEST_PATH = path.join(
  PROJECT_ROOT,
  "static",
  "binaries",
  ".install-manifest.json",
);
const STATIC_MANIFEST_PUBLIC_PATH = path.join(
  PROJECT_ROOT,
  "static",
  "binaries",
  "install-manifest.json",
);

const UA_HEADERS = {
  "User-Agent": "rozoom-k8s-linter-ide-downloader",
  Accept: "*/*",
};

// ── Build-time tool filter ───────────────────────────────────────
// Set VITE_ROZOOM_TOOLS=kubectl,helm,aws to download only selected tools.
// Unset or empty = all tools downloaded (default).
const ROZOOM_TOOLS_CSV = process.env.VITE_ROZOOM_TOOLS || "";
const ENABLED_TOOLS = ROZOOM_TOOLS_CSV.trim()
  ? new Set(
      ROZOOM_TOOLS_CSV.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;

function isToolEnabled(name) {
  return !ENABLED_TOOLS || ENABLED_TOOLS.has(name);
}

function getGitHubHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  return {
    "User-Agent": "rozoom-k8s-linter-ide-downloader",
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function httpsRequest(url, headers = UA_HEADERS) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => resolve(res)).on("error", reject);
  });
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch text with redirect support + strict status check.
 */
async function fetchText(url, headers = UA_HEADERS, maxRedirects = 8) {
  let current = url;

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await httpsRequest(current, headers);

    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      current = res.headers.location;
      continue;
    }

    if (res.statusCode !== 200) {
      res.resume();
      throw new Error(`HTTP ${res.statusCode} for ${current}`);
    }

    const text = await new Promise((resolve, reject) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve(data.trim()));
      res.on("error", reject);
    });

    return text;
  }

  throw new Error(`Too many redirects for ${url}`);
}

/**
 * Best-effort fetch: returns null on non-200 (after redirects).
 */
async function fetchLatestGitHubTag(repo) {
  const json = await fetchText(
    `https://api.github.com/repos/${repo}/releases/latest`,
    getGitHubHeaders(),
  );
  return JSON.parse(json).tag_name;
}

/**
 * Resolve the expected SHA256 for a GitHub release asset by locating a
 * sibling checksum asset (e.g. `<tool>_<ver>_checksums.txt`) and parsing
 * the line matching the binary file name.
 *
 * Returns `null` when no checksum asset exists in the release (upstream
 * simply does not publish one). Throws when the checksum asset exists
 * but fetching or parsing it fails - we never want to silently proceed.
 */
async function fetchReleaseChecksum(repo, tag, assetName) {
  const json = await fetchText(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
    getGitHubHeaders(),
  );
  const rel = JSON.parse(json);
  const assets = rel.assets || [];
  const checksumAsset = assets.find((a) =>
    /checksums?(\.txt)?$|sha256sums?(\.txt)?$/i.test(String(a?.name || "")),
  );
  if (!checksumAsset?.browser_download_url) return null;

  const text = await fetchText(checksumAsset.browser_download_url, UA_HEADERS);
  return parseShaFromText(text, assetName);
}

async function fetchTextOptional(url, headers = UA_HEADERS, maxRedirects = 8) {
  let current = url;

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await httpsRequest(current, headers);

    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      current = res.headers.location;
      continue;
    }

    if (res.statusCode !== 200) {
      res.resume();
      return null;
    }

    const text = await new Promise((resolve, reject) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve(data.trim()));
      res.on("error", reject);
    });

    return text;
  }

  return null;
}

/**
 * Download file with redirect support + strict status check.
 */
async function download(url, dest, headers = UA_HEADERS, maxRedirects = 8) {
  await fs.mkdir(path.dirname(dest), { recursive: true });

  let current = url;

  for (let i = 0; i <= maxRedirects; i++) {
    const res = await httpsRequest(current, headers);

    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      current = res.headers.location;
      continue;
    }

    if (res.statusCode !== 200) {
      res.resume();
      throw new Error(`HTTP ${res.statusCode} for ${current}`);
    }

    await new Promise((resolve, reject) => {
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
      res.on("error", reject);
    });

    return;
  }

  throw new Error(`Too many redirects for ${url}`);
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const rs = createReadStream(filePath);
    rs.on("data", (d) => hash.update(d));
    rs.on("end", () => resolve(hash.digest("hex")));
    rs.on("error", reject);
  });
}

/**
 * Supports:
 * - plain: "<hex>"
 * - sha256sum: "<hex>  filename" or "<hex> *filename"
 */
function parseShaFromText(text, wantedFileName = null) {
  const trimmed = text.trim();

  if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase();

  const lines = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const l of lines) {
    const m = l.match(/^([a-f0-9]{64})\s+\*?(.+)?$/i);
    if (!m) continue;

    const hex = m[1].toLowerCase();
    const name = (m[2] ?? "").trim();

    if (!wantedFileName) return hex;
    if (name === wantedFileName || path.basename(name) === path.basename(wantedFileName))
      return hex;
  }

  throw new Error("Could not parse sha256 from checksum text");
}

function chmodIfNeeded(p) {
  if (process.platform !== "win32") {
    execSync(`chmod +x "${p}"`);
  }
}

async function extractTarGz(source, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  execSync(`tar -xzf "${source}" -C "${destDir}" --no-same-owner`, { stdio: "inherit" });
}

async function rmForce(p) {
  await fs.rm(p, { recursive: true, force: true }).catch(() => {});
}

async function locateBinaryInExtractDir(extractDir, binaryNames) {
  const directCandidates = binaryNames.map((name) => path.join(extractDir, name));
  for (const candidate of directCandidates) {
    if (await fileExists(candidate)) return candidate;
  }

  const entries = await fs.readdir(extractDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const name of binaryNames) {
      const nested = path.join(extractDir, entry.name, name);
      if (await fileExists(nested)) return nested;
    }
  }

  return null;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* =======================
   Manifest helpers
======================= */

async function readManifest() {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data;
  } catch {
    // ignore
  }
  return { tools: {} };
}

async function writeManifest(m) {
  await fs.mkdir(TARGET_DIR, { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(m, null, 2) + "\n", "utf8");
}

async function getManifestEntry(name) {
  const m = await readManifest();
  return m.tools?.[name] ?? null;
}

async function setManifestEntry(name, entry) {
  const m = await readManifest();
  m.tools = m.tools ?? {};
  m.tools[name] = entry;
  await writeManifest(m);
}

async function copyManifestToStatic() {
  try {
    await fs.mkdir(path.dirname(STATIC_MANIFEST_PATH), { recursive: true });
    await fs.copyFile(MANIFEST_PATH, STATIC_MANIFEST_PATH);
    await fs.copyFile(MANIFEST_PATH, STATIC_MANIFEST_PUBLIC_PATH);
  } catch (err) {
    console.warn(
      "⚠️ Unable to sync manifest to static assets:",
      err instanceof Error ? err.message : err,
    );
  }
}

/* =======================
   Version / mode helpers
======================= */

/**
 * Mode:
 * - "latest": resolve latest upstream version (default)
 * - "pin": use env version if provided
 *
 * Env vars:
 * - KUBECTL_VERSION (e.g. "v1.30.3" or "1.30.3")
 * - HELM_VERSION   (e.g. "v3.16.2" or "3.16.2")
 * - DOCTL_VERSION  (e.g. "v1.110.0" or "1.110.0")
 * - PLUTO_VERSION  (e.g. "v5.20.3" or "5.20.3")
 * - GCLOUD_VERSION (optional; best-effort; see notes in installGcloudArchive)
 * - AWS_CLI_FILE   (optional; override AWS filename; advanced)
 */
function normalizeV(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.startsWith("v") ? s : `v${s}`;
}

function envOrNull(key) {
  const v = process.env[key];
  if (!v) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/* =======================
   Tauri externalBin helper
======================= */

function getTargetTriple() {
  try {
    const out = execSync("rustc -vV", { encoding: "utf8" });
    const m = out.match(/^host:\s+(\S+)$/m);
    if (m?.[1]) return m[1];
  } catch {
    // ignore
  }

  const p = os.platform();
  const a = os.arch();
  if (p === "linux" && a === "x64") return "x86_64-unknown-linux-gnu";
  if (p === "linux" && a === "arm64") return "aarch64-unknown-linux-gnu";
  if (p === "darwin" && a === "x64") return "x86_64-apple-darwin";
  if (p === "darwin" && a === "arm64") return "aarch64-apple-darwin";
  if (p === "win32" && a === "x64") return "x86_64-pc-windows-msvc";
  if (p === "win32" && a === "arm64") return "aarch64-pc-windows-msvc";
  return `${p}-${a}`;
}

async function ensureTauriExternalBinName(stablePath) {
  const triple = getTargetTriple();
  const dir = path.dirname(stablePath);

  const parsed = path.parse(stablePath);
  const out = path.join(dir, `${parsed.name}-${triple}${parsed.ext}`);

  if (await fileExists(out)) {
    chmodIfNeeded(out);
    return out;
  }

  await fs.copyFile(stablePath, out).catch((e) => {
    throw new Error(`Failed to create Tauri externalBin copy: ${out}\n${e?.message ?? e}`);
  });

  chmodIfNeeded(out);
  return out;
}

/**
 * Create a stub directory for a Tauri resource that isn't available on
 * the current platform.  Tauri's build requires all declared resources
 * to exist even if they won't be used at runtime.
 */
async function ensureResourceStub(dirName) {
  const stub = path.join(TARGET_DIR, dirName);
  if (await fileExists(stub)) return;
  await fs.mkdir(stub, { recursive: true });
  await fs.writeFile(
    path.join(stub, ".stub"),
    `Placeholder - ${dirName} is not available on ${os.platform()}/${os.arch()}\n`,
  );
  console.log(`  created stub: ${dirName}/`);
}

/* =======================
   Common: download only when needed
======================= */

async function downloadIfMissingOrInvalid({
  url,
  shaUrl,
  out,
  headers = UA_HEADERS,
  wantedFileName = null,
  toolNameForLog = "file",
}) {
  const shaText = await fetchText(shaUrl, headers);
  const expected = parseShaFromText(shaText, wantedFileName);

  if (await fileExists(out)) {
    const actual = await sha256(out);
    if (actual === expected) {
      console.log(`✓ cached: ${toolNameForLog} (sha256 ok)`);
      return { expected, actual, skipped: true };
    }
  }

  await download(url, out, headers);

  const actual = await sha256(out);
  if (actual !== expected) {
    throw new Error(`${toolNameForLog} checksum mismatch\nexpected=${expected}\nactual=${actual}`);
  }

  return { expected, actual, skipped: false };
}

/* =======================
   kubectl
======================= */

async function installKubectl() {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "amd64" : "arm64";

  const osMap = { win32: "windows", linux: "linux", darwin: "darwin" };
  const ext = platform === "win32" ? ".exe" : "";

  const pinned = normalizeV(envOrNull("KUBECTL_VERSION"));
  const version = pinned ?? (await fetchText("https://dl.k8s.io/release/stable.txt", UA_HEADERS));

  if (version.includes("<html")) {
    throw new Error(`kubectl version fetch returned HTML: ${version.slice(0, 80)}`);
  }

  const file = `kubectl${ext}`;
  const url = `https://dl.k8s.io/release/${version}/bin/${osMap[platform]}/${arch}/${file}`;
  const shaUrl = `${url}.sha256`;

  const out = path.join(TARGET_DIR, `kubectl${ext}`);

  const cached = await getManifestEntry("kubectl");
  if (cached?.version === version && (await fileExists(out))) {
    // Still verify via remote sha for safety
    await downloadIfMissingOrInvalid({
      url,
      shaUrl,
      out,
      headers: UA_HEADERS,
      toolNameForLog: "kubectl",
    });
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);
    console.log(`✓ kubectl installed (${version})`);
    return;
  }

  const r = await downloadIfMissingOrInvalid({
    url,
    shaUrl,
    out,
    headers: UA_HEADERS,
    toolNameForLog: "kubectl",
  });

  chmodIfNeeded(out);
  await ensureTauriExternalBinName(out);

  await setManifestEntry("kubectl", {
    version,
    file: path.basename(out),
    sha256: r.actual,
    mode: pinned ? "pin" : "latest",
    updatedAt: new Date().toISOString(),
  });

  console.log(`✓ kubectl installed (${version})`);
}

/* =======================
   helm (cache via manifest)
======================= */

async function resolveHelmReleaseTag() {
  const pinned = normalizeV(envOrNull("HELM_VERSION"));
  if (pinned) return pinned;

  const releaseJson = await fetchText(
    "https://api.github.com/repos/helm/helm/releases/latest",
    getGitHubHeaders(),
  );
  const release = JSON.parse(releaseJson);
  return release.tag_name; // "vX.Y.Z"
}

async function installHelm() {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "amd64" : "arm64";
  const osName = platform === "win32" ? "windows" : platform;
  const ext = platform === "win32" ? "zip" : "tar.gz";

  const tag = await resolveHelmReleaseTag();
  const ver = tag.replace(/^v/i, "");

  const out = path.join(TARGET_DIR, platform === "win32" ? "helm.exe" : "helm");
  const cached = await getManifestEntry("helm");

  if (cached?.version === tag && (await fileExists(out))) {
    const actual = await sha256(out);
    if (cached.sha256 === actual) {
      chmodIfNeeded(out);
      await ensureTauriExternalBinName(out);
      console.log(`✓ cached: helm (${tag})`);
      return;
    }
  }

  const file = `helm-v${ver}-${osName}-${arch}.${ext}`;
  const checksumName = `${file}.sha256sum`;

  let binUrl = `https://get.helm.sh/${file}`;
  let shaUrl = `https://get.helm.sh/${checksumName}`;

  // For "latest" mode, try GitHub release assets first (more canonical)
  if (!envOrNull("HELM_VERSION")) {
    const releaseJson = await fetchText(
      "https://api.github.com/repos/helm/helm/releases/latest",
      getGitHubHeaders(),
    );
    const release = JSON.parse(releaseJson);
    const assets = release.assets || [];
    const binAsset = assets.find((a) => a?.name === file);
    const shaAsset = assets.find((a) => a?.name === checksumName);

    binUrl = binAsset?.browser_download_url ?? binUrl;
    shaUrl = shaAsset?.browser_download_url ?? shaUrl;
  }

  const extractDir = path.join(TARGET_DIR, "helm-extract");
  const tmp = path.join(TARGET_DIR, file);

  try {
    // Verify archive via sha256sum, then extract binary
    const r = await downloadIfMissingOrInvalid({
      url: binUrl,
      shaUrl,
      out: tmp,
      headers: UA_HEADERS,
      wantedFileName: file,
      toolNameForLog: `helm archive (${tag})`,
    });

    await rmForce(extractDir);
    await fs.mkdir(extractDir, { recursive: true });

    if (ext === "zip") await extractZip(tmp, { dir: extractDir });
    else await extractTarGz(tmp, extractDir);

    const helmBin = path.join(
      extractDir,
      `${osName}-${arch}`,
      platform === "win32" ? "helm.exe" : "helm",
    );

    await fs.copyFile(helmBin, out);
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);

    const installedSha = await sha256(out);
    await setManifestEntry("helm", {
      version: tag,
      file: path.basename(out),
      sha256: installedSha,
      archiveSha256: r.actual,
      mode: envOrNull("HELM_VERSION") ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });

    console.log(`✓ helm installed (${tag})`);
  } finally {
    await rmForce(tmp);
    await rmForce(extractDir);
  }
}

/* =======================
   doctl (cache via manifest)
======================= */

async function resolveDoctlTag() {
  const pinned = normalizeV(envOrNull("DOCTL_VERSION"));
  if (pinned) return pinned;

  const latestJson = await fetchText(
    "https://api.github.com/repos/digitalocean/doctl/releases/latest",
    getGitHubHeaders(),
  );
  return JSON.parse(latestJson).tag_name; // "vX.Y.Z"
}

async function installDoctl() {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "amd64" : "arm64";
  const osName = platform === "win32" ? "windows" : platform;
  const ext = platform === "win32" ? "zip" : "tar.gz";

  const vTag = await resolveDoctlTag();
  const ver = vTag.replace(/^v/i, "");

  const out = path.join(TARGET_DIR, platform === "win32" ? "doctl.exe" : "doctl");
  const cached = await getManifestEntry("doctl");

  if (cached?.version === vTag && (await fileExists(out))) {
    const actual = await sha256(out);
    if (cached.sha256 === actual) {
      chmodIfNeeded(out);
      await ensureTauriExternalBinName(out);
      console.log(`✓ cached: doctl (${vTag})`);
      return;
    }
  }

  const file = `doctl-${ver}-${osName}-${arch}.${ext}`;
  const url = `https://github.com/digitalocean/doctl/releases/download/${vTag}/${file}`;

  // Resolve checksums from the release assets
  const relJson = await fetchText(
    `https://api.github.com/repos/digitalocean/doctl/releases/tags/${vTag}`,
    getGitHubHeaders(),
  );
  const rel = JSON.parse(relJson);

  const checksumAsset =
    (rel.assets || []).find((a) => /checksums?/i.test(a.name)) ||
    (rel.assets || []).find((a) => /sha256/i.test(a.name));

  if (!checksumAsset?.browser_download_url) {
    throw new Error("doctl checksums asset not found in release");
  }

  const checksumText = await fetchText(checksumAsset.browser_download_url, UA_HEADERS);
  const expected = parseShaFromText(checksumText, file);

  const extractDir = path.join(TARGET_DIR, "doctl-extract");
  const tmp = path.join(TARGET_DIR, file);

  try {
    // If archive already exists and matches expected, skip downloading it
    if (await fileExists(tmp)) {
      const actualTmp = await sha256(tmp);
      if (actualTmp !== expected) await rmForce(tmp);
    }

    if (!(await fileExists(tmp))) {
      await download(url, tmp, UA_HEADERS);
      const actualTmp = await sha256(tmp);
      if (actualTmp !== expected) {
        throw new Error(`doctl checksum mismatch\nexpected=${expected}\nactual=${actualTmp}`);
      }
    } else {
      console.log(`✓ cached: doctl archive (${vTag})`);
    }

    await rmForce(extractDir);
    await fs.mkdir(extractDir, { recursive: true });

    if (ext === "zip") await extractZip(tmp, { dir: extractDir });
    else await extractTarGz(tmp, extractDir);

    const candidate = path.join(extractDir, platform === "win32" ? "doctl.exe" : "doctl");
    await fs.copyFile(candidate, out);

    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);

    const installedSha = await sha256(out);
    await setManifestEntry("doctl", {
      version: vTag,
      file: path.basename(out),
      sha256: installedSha,
      archiveSha256: expected,
      mode: envOrNull("DOCTL_VERSION") ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });

    console.log(`✓ doctl installed (${vTag})`);
  } finally {
    await rmForce(tmp);
    await rmForce(extractDir);
  }
}

/* =======================
   Pluto (cache via manifest)
======================= */

async function resolvePlutoTag() {
  const pinned = normalizeV(envOrNull("PLUTO_VERSION"));
  if (pinned) return pinned;

  const latestJson = await fetchText(
    "https://api.github.com/repos/FairwindsOps/pluto/releases/latest",
    getGitHubHeaders(),
  );
  return JSON.parse(latestJson).tag_name; // "vX.Y.Z"
}

function pickPlutoAsset(assets, platform, arch) {
  const exts = platform === "win32" ? [".tar.gz", ".zip"] : [".tar.gz"];
  const osKeys =
    platform === "win32"
      ? ["windows", "win"]
      : platform === "darwin"
        ? ["darwin", "macos"]
        : ["linux"];
  const archKeys = arch === "x64" ? ["amd64", "x86_64"] : ["arm64", "aarch64"];

  return assets.find((asset) => {
    const n = String(asset?.name || "").toLowerCase();
    if (!n.includes("pluto")) return false;
    if (!exts.some((ext) => n.endsWith(ext))) return false;
    if (n.includes("checksum") || n.includes("sha256")) return false;
    return osKeys.some((k) => n.includes(k)) && archKeys.some((k) => n.includes(k));
  });
}

async function installPluto() {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "x64" : "arm64";

  const tag = await resolvePlutoTag();
  const out = path.join(TARGET_DIR, platform === "win32" ? "pluto.exe" : "pluto");
  const cached = await getManifestEntry("pluto");

  if (cached?.version === tag && (await fileExists(out))) {
    const actual = await sha256(out);
    if (cached.sha256 === actual) {
      chmodIfNeeded(out);
      await ensureTauriExternalBinName(out);
      console.log(`✓ cached: pluto (${tag})`);
      return;
    }
  }

  const relJson = await fetchText(
    `https://api.github.com/repos/FairwindsOps/pluto/releases/tags/${tag}`,
    getGitHubHeaders(),
  );
  const rel = JSON.parse(relJson);
  const assets = rel.assets || [];

  const binAsset = pickPlutoAsset(assets, platform, arch);
  if (!binAsset?.browser_download_url || !binAsset?.name) {
    throw new Error(`pluto asset not found for ${platform}/${arch} in ${tag}`);
  }

  const checksumAsset = assets.find((a) => /checksums?|sha256sums?/i.test(String(a?.name || "")));
  if (!checksumAsset?.browser_download_url) {
    throw new Error(`pluto checksum asset not found for release ${tag}`);
  }

  const checksumText = await fetchText(checksumAsset.browser_download_url, UA_HEADERS);
  const expected = parseShaFromText(checksumText, binAsset.name);

  const extractDir = path.join(TARGET_DIR, "pluto-extract");
  const tmp = path.join(TARGET_DIR, binAsset.name);

  try {
    if (await fileExists(tmp)) {
      const actualTmp = await sha256(tmp);
      if (actualTmp !== expected) await rmForce(tmp);
    }

    if (!(await fileExists(tmp))) {
      await download(binAsset.browser_download_url, tmp, UA_HEADERS);
      const actualTmp = await sha256(tmp);
      if (actualTmp !== expected) {
        throw new Error(`pluto checksum mismatch\nexpected=${expected}\nactual=${actualTmp}`);
      }
    } else {
      console.log(`✓ cached: pluto archive (${tag})`);
    }

    await rmForce(extractDir);
    await fs.mkdir(extractDir, { recursive: true });

    if (tmp.endsWith(".zip")) {
      await extractZip(tmp, { dir: extractDir });
    } else {
      await extractTarGz(tmp, extractDir);
    }

    const binName = platform === "win32" ? "pluto.exe" : "pluto";
    const candidate = await locateBinaryInExtractDir(extractDir, [binName, "pluto"]);
    if (!candidate) {
      throw new Error(`pluto binary not found in extracted archive for ${tag}`);
    }

    await fs.copyFile(candidate, out);
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);

    const installedSha = await sha256(out);
    await setManifestEntry("pluto", {
      version: tag,
      file: path.basename(out),
      sha256: installedSha,
      archiveSha256: expected,
      mode: envOrNull("PLUTO_VERSION") ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });

    console.log(`✓ pluto installed (${tag})`);
  } finally {
    await rmForce(tmp);
    await rmForce(extractDir);
  }
}

/* =======================
   Velero (cache via manifest)
======================= */

async function resolveVeleroTag() {
  const pinned = normalizeV(envOrNull("VELERO_VERSION"));
  if (pinned) return pinned;

  const latestJson = await fetchText(
    "https://api.github.com/repos/vmware-tanzu/velero/releases/latest",
    getGitHubHeaders(),
  );
  return JSON.parse(latestJson).tag_name; // "vX.Y.Z"
}

function pickVeleroAsset(assets, platform, arch) {
  const ext = platform === "win32" ? ".tar.gz" : ".tar.gz";
  const osKey = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
  const archKey = arch === "x64" ? "amd64" : "arm64";

  return assets.find((asset) => {
    const n = String(asset?.name || "").toLowerCase();
    if (!n.includes("velero")) return false;
    if (!n.endsWith(ext)) return false;
    if (n.includes("checksum") || n.includes("sha256")) return false;
    return n.includes(osKey) && n.includes(archKey);
  });
}

async function installVelero() {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "x64" : "arm64";

  const tag = await resolveVeleroTag();
  const out = path.join(TARGET_DIR, platform === "win32" ? "velero.exe" : "velero");
  const cached = await getManifestEntry("velero");

  if (cached?.version === tag && (await fileExists(out))) {
    const actual = await sha256(out);
    if (cached.sha256 === actual) {
      chmodIfNeeded(out);
      await ensureTauriExternalBinName(out);
      console.log(`✓ cached: velero (${tag})`);
      return;
    }
  }

  const relJson = await fetchText(
    `https://api.github.com/repos/vmware-tanzu/velero/releases/tags/${tag}`,
    getGitHubHeaders(),
  );
  const rel = JSON.parse(relJson);
  const assets = rel.assets || [];

  const binAsset = pickVeleroAsset(assets, platform, arch);
  if (!binAsset?.browser_download_url || !binAsset?.name) {
    throw new Error(`velero asset not found for ${platform}/${arch} in ${tag}`);
  }

  const checksumAsset = assets.find((a) => /checksums?|sha256sums?/i.test(String(a?.name || "")));
  if (!checksumAsset?.browser_download_url) {
    throw new Error(`velero checksum asset not found for release ${tag}`);
  }

  const checksumText = await fetchText(checksumAsset.browser_download_url, UA_HEADERS);
  const expected = parseShaFromText(checksumText, binAsset.name);

  const extractDir = path.join(TARGET_DIR, "velero-extract");
  const tmp = path.join(TARGET_DIR, binAsset.name);

  try {
    if (await fileExists(tmp)) {
      const actualTmp = await sha256(tmp);
      if (actualTmp !== expected) await rmForce(tmp);
    }

    if (!(await fileExists(tmp))) {
      await download(binAsset.browser_download_url, tmp, UA_HEADERS);
      const actualTmp = await sha256(tmp);
      if (actualTmp !== expected) {
        throw new Error(`velero checksum mismatch\nexpected=${expected}\nactual=${actualTmp}`);
      }
    } else {
      console.log(`✓ cached: velero archive (${tag})`);
    }

    await rmForce(extractDir);
    await fs.mkdir(extractDir, { recursive: true });
    await extractTarGz(tmp, extractDir);

    const binName = platform === "win32" ? "velero.exe" : "velero";
    const candidate = await locateBinaryInExtractDir(extractDir, [binName, "velero"]);
    if (!candidate) {
      throw new Error(`velero binary not found in extracted archive for ${tag}`);
    }

    await fs.copyFile(candidate, out);
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);

    const installedSha = await sha256(out);
    await setManifestEntry("velero", {
      version: tag,
      file: path.basename(out),
      sha256: installedSha,
      archiveSha256: expected,
      mode: envOrNull("VELERO_VERSION") ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });

    console.log(`✓ velero installed (${tag})`);
  } finally {
    await rmForce(tmp);
    await rmForce(extractDir);
  }
}

/* =======================
   gcloud: bundle as ONE archive file (prevents tauri-build stack overflow)
======================= */

function getGcloudFileName(versionOverride = null) {
  const platform = os.platform();
  const arch = os.arch();

  // Latest (no version in name, "rapid/downloads/<fileName>")
  if (!versionOverride) {
    if (platform === "linux") {
      return arch === "x64"
        ? "google-cloud-cli-linux-x86_64.tar.gz"
        : "google-cloud-cli-linux-arm.tar.gz";
    }
    if (platform === "darwin") {
      return arch === "x64"
        ? "google-cloud-cli-darwin-x86_64.tar.gz"
        : "google-cloud-cli-darwin-arm.tar.gz";
    }
    if (platform === "win32") {
      if (arch !== "x64") return null;
      return "google-cloud-cli-windows-x86_64.zip";
    }
    return null;
  }

  // Pinned: best-effort pattern used by Google archives:
  // google-cloud-cli-<VERSION>-<platform>-<arch>.{tar.gz|zip}
  // If this pattern ever changes, can override via GCLOUD_URL + GCLOUD_SHA256.
  const v = String(versionOverride).trim();
  if (!v) return null;

  if (platform === "linux") {
    return arch === "x64"
      ? `google-cloud-cli-${v}-linux-x86_64.tar.gz`
      : `google-cloud-cli-${v}-linux-arm.tar.gz`;
  }
  if (platform === "darwin") {
    return arch === "x64"
      ? `google-cloud-cli-${v}-darwin-x86_64.tar.gz`
      : `google-cloud-cli-${v}-darwin-arm.tar.gz`;
  }
  if (platform === "win32") {
    if (arch !== "x64") return null;
    return `google-cloud-cli-${v}-windows-x86_64.zip`;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function installGcloudArchive() {
  const platform = os.platform();
  const arch = os.arch();

  const pinnedVer = envOrNull("GCLOUD_VERSION");
  const overrideUrl = envOrNull("GCLOUD_URL");
  const overrideSha = envOrNull("GCLOUD_SHA256");

  const fileName = getGcloudFileName(pinnedVer);
  if (!fileName) {
    console.log(`⚠️ gcloud not supported on ${platform}/${arch} in this script mode`);
    return;
  }

  const out = path.join(TARGET_DIR, "google-cloud-cli-archive");

  // Resolve URL
  let url = overrideUrl;
  if (!url) {
    url = `https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/${fileName}`;
  }

  // Resolve expected sha
  let expected = overrideSha ? String(overrideSha).trim().toLowerCase() : null;

  // If not overridden, try to parse from the official downloads page (works best for latest).
  if (!expected) {
    const pageUrl = "https://docs.cloud.google.com/sdk/docs/downloads-versioned-archives";
    const html = await fetchText(pageUrl, UA_HEADERS);

    // Try to locate direct href for the selected filename
    const hrefRe = new RegExp(`href="([^"]+)"[^>]*>\\s*${escapeRegExp(fileName)}\\s*<`, "i");
    const hrefMatch = html.match(hrefRe);
    if (hrefMatch?.[1]) {
      let href = hrefMatch[1];
      if (href.startsWith("/")) href = `https://dl.google.com${href}`;
      url = overrideUrl ?? href;
    }

    const shaRe = new RegExp(`${escapeRegExp(fileName)}[\\s\\S]{0,800}?([a-f0-9]{64})`, "i");
    const shaMatch = html.match(shaRe);
    if (!shaMatch?.[1]) {
      // Best-effort fallback: sometimes Google provides a .sha256 file (not always)
      const shaTextOpt = await fetchTextOptional(`${url}.sha256`, UA_HEADERS);
      if (shaTextOpt) expected = parseShaFromText(shaTextOpt, null);
      else {
        throw new Error(
          `Failed to resolve gcloud sha256 for ${fileName}. Provide GCLOUD_SHA256 (or GCLOUD_URL+GCLOUD_SHA256).`,
        );
      }
    } else {
      expected = shaMatch[1].toLowerCase();
    }
  }

  // If already present and checksum matches - skip
  if (await fileExists(out)) {
    const actual = await sha256(out);
    if (actual === expected) {
      let cachedGcloudVersion = pinnedVer ?? "latest";
      if (cachedGcloudVersion === "latest") {
        try {
          const v = (
            await fs.readFile(path.join(TARGET_DIR, "google-cloud-sdk", "VERSION"), "utf8")
          ).trim();
          if (v) cachedGcloudVersion = v;
        } catch {
          /* fallback */
        }
      }
      console.log(`✓ cached: gcloud archive v${cachedGcloudVersion} (sha256 ok)`);
      await setManifestEntry("gcloud", {
        version: cachedGcloudVersion,
        file: path.basename(out),
        sha256: actual,
        sourceFileName: fileName,
        mode: pinnedVer ? "pin" : "latest",
        updatedAt: new Date().toISOString(),
      });
      return;
    }
  }

  const tmp = path.join(TARGET_DIR, fileName);

  try {
    await download(url, tmp, UA_HEADERS);
    const actual = await sha256(tmp);
    if (actual !== expected) {
      throw new Error(`gcloud checksum mismatch\nexpected=${expected}\nactual=${actual}`);
    }

    // Store as single stable file for Tauri resources
    await fs.copyFile(tmp, out);

    let gcloudVersion = pinnedVer ?? "latest";
    if (gcloudVersion === "latest") {
      try {
        const v = (
          await fs.readFile(path.join(TARGET_DIR, "google-cloud-sdk", "VERSION"), "utf8")
        ).trim();
        if (v) gcloudVersion = v;
      } catch {
        /* fallback to "latest" */
      }
    }

    await setManifestEntry("gcloud", {
      version: gcloudVersion,
      file: path.basename(out),
      sha256: actual,
      sourceFileName: fileName,
      mode: pinnedVer ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });

    console.log(`✓ gcloud archive prepared v${gcloudVersion} (bundled as single resource file)`);
  } finally {
    await rmForce(tmp);
  }
}

/* =======================
   AWS CLI v2 (Linux) - verify via PGP .sig
======================= */

function hasGpg() {
  try {
    execSync("gpg --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function getAwsCliPgpPublicKey() {
  const html = await fetchText(
    "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
    UA_HEADERS,
  );
  const m = html.match(
    /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/,
  );
  if (!m) throw new Error("AWS PGP public key block not found in AWS docs page");
  return m[0];
}

const AWS_CLI_PGP_FPR = "FB5DB77FD5C118B80511ADA8A6310ACC4672475C";

function normalizeFpr(s) {
  return String(s).replace(/\s+/g, "").toUpperCase();
}

async function verifyAwsSig(zipPath, sigPath) {
  if (!hasGpg()) {
    throw new Error(
      'gpg is required to verify AWS CLI signature. Install "gnupg" in your build image.',
    );
  }

  const keyText = await getAwsCliPgpPublicKey();

  const tmpBase = path.join(TARGET_DIR, ".tmp-aws-verify");
  const gnupgHome = path.join(tmpBase, "gnupg");
  const keyFile = path.join(tmpBase, "awscli.pgp");

  const env = { ...process.env, GNUPGHOME: gnupgHome };

  try {
    await fs.rm(tmpBase, { recursive: true, force: true });
    await fs.mkdir(gnupgHome, { recursive: true });

    if (process.platform !== "win32") {
      execSync(`chmod 700 "${gnupgHome}"`);
    }

    await fs.writeFile(keyFile, keyText, "utf8");

    execSync(`gpg --batch --import "${keyFile}"`, { stdio: "inherit", env });

    const fprOut = execSync(`gpg --batch --with-colons --fingerprint`, { encoding: "utf8", env });
    const fprLine = fprOut.split("\n").find((l) => l.startsWith("fpr:") && l.includes(":"));
    if (!fprLine) throw new Error("Unable to read imported key fingerprint");

    const importedFpr = normalizeFpr(fprLine.split(":")[9] ?? "");
    if (importedFpr !== AWS_CLI_PGP_FPR) {
      throw new Error(
        `AWS PGP fingerprint mismatch\nexpected=${AWS_CLI_PGP_FPR}\nactual=${importedFpr}`,
      );
    }

    execSync(`gpg --batch --verify "${sigPath}" "${zipPath}"`, { stdio: "inherit", env });
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true });
  }
}

async function installAws() {
  const platform = os.platform();
  const arch = os.arch();

  if (platform !== "linux") {
    console.log(
      "⚠️ AWS CLI auto-download currently supported only for Linux (zip + PGP .sig verification).",
    );
    // Create stub so Tauri build doesn't fail on missing resource
    await ensureResourceStub("aws-dist");
    return;
  }

  const awsBin = path.join(TARGET_DIR, "aws-dist", "aws");
  const cached = await getManifestEntry("aws");

  if (cached?.file === "aws-dist/aws" && (await fileExists(awsBin))) {
    const actual = await sha256(awsBin);
    if (cached.sha256 === actual) {
      chmodIfNeeded(awsBin);
      console.log("✓ cached: aws (binary sha256 ok)");
      return;
    }
  }

  const extractDir = path.join(TARGET_DIR, "aws-extract");
  let tmpZip = null;
  let tmpSig = null;

  try {
    const overrideFile = envOrNull("AWS_CLI_FILE");
    const file =
      overrideFile ??
      (arch === "x64" ? "awscli-exe-linux-x86_64.zip" : "awscli-exe-linux-aarch64.zip");

    const url = `https://awscli.amazonaws.com/${file}`;
    const sigUrl = `${url}.sig`;

    tmpZip = path.join(TARGET_DIR, file);
    tmpSig = path.join(TARGET_DIR, `${file}.sig`);

    await download(url, tmpZip, UA_HEADERS);
    await download(sigUrl, tmpSig, UA_HEADERS);

    await verifyAwsSig(tmpZip, tmpSig);

    await rmForce(extractDir);
    await fs.mkdir(extractDir, { recursive: true });

    await extractZip(tmpZip, { dir: extractDir });

    const awsDistDir = path.join(TARGET_DIR, "aws-dist");
    await rmForce(awsDistDir);
    await fs.cp(path.join(extractDir, "aws/dist"), awsDistDir, { recursive: true });
    chmodIfNeeded(path.join(awsDistDir, "aws"));

    const installedSha = await sha256(path.join(awsDistDir, "aws"));

    let awsVersion = "latest";
    try {
      const { execFileSync } = await import("child_process");
      const raw = execFileSync(path.join(awsDistDir, "aws"), ["--version"], {
        encoding: "utf8",
        timeout: 10000,
      });
      const m = raw.match(/aws-cli\/([\d.]+)/);
      if (m) awsVersion = `v${m[1]}`;
    } catch {
      /* fallback to "latest" */
    }

    await setManifestEntry("aws", {
      version: awsVersion,
      file: "aws-dist/aws",
      sha256: installedSha,
      mode: "latest",
      updatedAt: new Date().toISOString(),
    });

    console.log("✓ aws installed as resource dir (verified via PGP .sig)");
  } finally {
    if (tmpZip) await rmForce(tmpZip);
    if (tmpSig) await rmForce(tmpSig);
    await rmForce(extractDir);
  }
}

/* =======================
   Azure CLI
======================= */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function installAz() {
  console.log(
    "⚠️ Azure CLI is not bundled by this script (official install uses packages/script).",
  );
  console.log("   Linux (Debian/Ubuntu): curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash");
  console.log("   macOS: brew install azure-cli");
  console.log("   Windows: https://aka.ms/installazurecliwindows");
}

/* =======================
   Generic GitHub release installer
   (kustomize, kubeconform, stern, yq)
======================= */

function ghReleaseAssetPattern(_toolName, platform, arch) {
  const osKey = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
  const archKey = arch === "x64" ? "amd64" : "arm64";
  return { osKey, archKey, ext: platform === "win32" ? ".zip" : ".tar.gz" };
}

async function installGhReleaseTool({
  name,
  repo,
  envVar,
  pickAsset,
  binaryNames,
  extractBinary = true,
  skipChecksumAsset = false,
}) {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "x64" : "arm64";
  const exe = platform === "win32" ? `${name}.exe` : name;

  const pinned = normalizeV(envOrNull(envVar));
  let tag;
  if (pinned) {
    tag = pinned;
  } else {
    const latestJson = await fetchText(
      `https://api.github.com/repos/${repo}/releases/latest`,
      getGitHubHeaders(),
    );
    tag = JSON.parse(latestJson).tag_name;
  }

  const out = path.join(TARGET_DIR, exe);
  const cached = await getManifestEntry(name);

  if (cached?.version === tag && (await fileExists(out))) {
    const actual = await sha256(out);
    if (cached.sha256 === actual) {
      chmodIfNeeded(out);
      await ensureTauriExternalBinName(out);
      console.log(`✓ cached: ${name} (${tag})`);
      return;
    }
  }

  const relJson = await fetchText(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
    getGitHubHeaders(),
  );
  const rel = JSON.parse(relJson);
  const assets = rel.assets || [];

  const { osKey, archKey, ext } = ghReleaseAssetPattern(name, platform, arch);
  const binAsset = pickAsset
    ? pickAsset(assets, osKey, archKey, ext)
    : assets.find((a) => {
        const n = String(a?.name || "").toLowerCase();
        if (n.includes("checksum") || n.includes("sha256")) return false;
        return n.includes(osKey) && n.includes(archKey) && n.endsWith(ext);
      });

  if (!binAsset?.browser_download_url) {
    throw new Error(`${name} asset not found for ${platform}/${arch} in ${tag}`);
  }

  let expected = null;
  if (!skipChecksumAsset) {
    const checksumAsset = assets.find((a) => /checksums?|sha256/i.test(String(a?.name || "")));
    if (checksumAsset?.browser_download_url) {
      const checksumText = await fetchText(checksumAsset.browser_download_url, UA_HEADERS);
      expected = parseShaFromText(checksumText, binAsset.name);
    }
  }

  const tmp = path.join(TARGET_DIR, binAsset.name);
  const extractDir = path.join(TARGET_DIR, `${name}-extract`);

  try {
    if (await fileExists(tmp)) {
      if (expected) {
        const actualTmp = await sha256(tmp);
        if (actualTmp !== expected) await rmForce(tmp);
      }
    }

    if (!(await fileExists(tmp))) {
      await download(binAsset.browser_download_url, tmp, UA_HEADERS);
      if (expected) {
        const actualTmp = await sha256(tmp);
        if (actualTmp !== expected) {
          throw new Error(`${name} checksum mismatch\nexpected=${expected}\nactual=${actualTmp}`);
        }
      }
    }

    if (extractBinary && (tmp.endsWith(".tar.gz") || tmp.endsWith(".zip"))) {
      await rmForce(extractDir);
      await fs.mkdir(extractDir, { recursive: true });

      if (tmp.endsWith(".zip")) {
        await extractZip(tmp, { dir: extractDir });
      } else {
        await extractTarGz(tmp, extractDir);
      }

      const names = binaryNames || [exe, name];
      const candidate = await locateBinaryInExtractDir(extractDir, names);
      if (!candidate) {
        throw new Error(`${name} binary not found in extracted archive for ${tag}`);
      }
      await fs.copyFile(candidate, out);
    } else {
      // Direct binary download (e.g. yq_linux_amd64)
      await fs.copyFile(tmp, out);
    }

    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);

    const installedSha = await sha256(out);
    await setManifestEntry(name, {
      version: tag,
      file: path.basename(out),
      sha256: installedSha,
      archiveSha256: expected,
      mode: envOrNull(envVar) ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });

    console.log(`✓ ${name} installed (${tag})`);
  } finally {
    await rmForce(tmp);
    await rmForce(extractDir);
  }
}

async function installKustomize() {
  await installGhReleaseTool({
    name: "kustomize",
    repo: "kubernetes-sigs/kustomize",
    envVar: "KUSTOMIZE_VERSION",
    pickAsset: (assets, osKey, archKey, ext) =>
      assets.find((a) => {
        const n = String(a?.name || "").toLowerCase();
        return (
          n.includes("kustomize") && n.includes(osKey) && n.includes(archKey) && n.endsWith(ext)
        );
      }),
  });
}

async function installKubeconform() {
  await installGhReleaseTool({
    name: "kubeconform",
    repo: "yannh/kubeconform",
    envVar: "KUBECONFORM_VERSION",
  });
}

async function installStern() {
  await installGhReleaseTool({
    name: "stern",
    repo: "stern/stern",
    envVar: "STERN_VERSION",
  });
}

async function installYq() {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "x64" : "arm64";
  const { osKey, archKey } = ghReleaseAssetPattern("yq", platform, arch);
  const winExt = platform === "win32" ? ".exe" : "";
  const directBinaryName = `yq_${osKey}_${archKey}${winExt}`;

  await installGhReleaseTool({
    name: "yq",
    repo: "mikefarah/yq",
    envVar: "YQ_VERSION",
    pickAsset: (assets) => assets.find((a) => String(a?.name || "") === directBinaryName),
    // yq checksums file uses a non-standard multi-hash format - skip checksum matching
    skipChecksumAsset: true,
    extractBinary: false,
  });
}

async function installHcloud() {
  await installGhReleaseTool({
    name: "hcloud",
    repo: "hetznercloud/cli",
    envVar: "HCLOUD_VERSION",
  });
}

async function installOc() {
  await installGhReleaseTool({
    name: "oc",
    repo: "okd-project/okd",
    envVar: "OC_VERSION",
    pickAsset: (assets, osKey, archKey, ext) => {
      // OKD uses "mac" instead of "darwin" in asset names
      const ocOsKey = osKey === "darwin" ? "mac" : osKey;
      // OKD omits arch suffix for amd64 (it's the default),
      // so for amd64 match assets that have the OS but NOT any other arch
      const isDefaultArch = archKey === "amd64";
      return assets.find((a) => {
        const n = String(a?.name || "").toLowerCase();
        if (!n.includes("openshift-client") || !n.includes(ocOsKey) || !n.endsWith(ext))
          return false;
        if (n.includes("rhel")) return false;
        if (isDefaultArch) {
          // Match the asset without an explicit arch (e.g. openshift-client-mac-4.21...)
          return !n.includes("arm64") && !n.includes("ppc64") && !n.includes("s390x");
        }
        return n.includes(archKey);
      });
    },
  });
}

/* =======================
   Azure CLI (DEB package extraction)
======================= */

async function installAzCli() {
  const platform = os.platform();
  if (platform !== "linux") {
    console.log("⚠️ Azure CLI auto-download currently supported only for Linux (DEB extraction).");
    // Create stubs so Tauri build doesn't fail on missing resource/sidecar
    await ensureResourceStub("az-dist");
    return;
  }

  const azDistDir = path.join(TARGET_DIR, "az-dist");
  const azBin = path.join(azDistDir, "bin", "az");
  const cached = await getManifestEntry("az");

  if (cached?.file === "az-dist/bin/az" && (await fileExists(azBin))) {
    const actual = await sha256(azBin);
    if (cached.sha256 === actual) {
      console.log(`✓ cached: az (${cached.version})`);
      return;
    }
  }

  const distro = envOrNull("AZ_DEB_DISTRO") || "noble";
  const debUrl = `https://packages.microsoft.com/repos/azure-cli/pool/main/a/azure-cli/`;

  // Fetch listing to find latest DEB
  const listing = await fetchText(debUrl, UA_HEADERS);
  const debs = [...listing.matchAll(/azure-cli_([\d.]+)-1~[a-z]+_amd64\.deb/g)].map((m) => ({
    file: m[0],
    version: m[1],
  }));
  debs.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));

  const pinnedVer = envOrNull("AZ_VERSION");
  let target;
  if (pinnedVer) {
    target = debs.find((d) => d.version === pinnedVer.replace(/^v/, ""));
    if (!target) throw new Error(`az version ${pinnedVer} not found in DEB repo`);
  } else {
    target = debs[debs.length - 1];
  }
  if (!target) throw new Error("No Azure CLI DEB found in repository listing");

  const debFile = `azure-cli_${target.version}-1~${distro}_amd64.deb`;
  const fullUrl = `${debUrl}${debFile}`;
  const tmpDeb = path.join(TARGET_DIR, "azure-cli.deb");
  const extractDir = path.join(TARGET_DIR, "az-extract");

  try {
    await download(fullUrl, tmpDeb, UA_HEADERS);

    await rmForce(extractDir);
    await fs.mkdir(extractDir, { recursive: true });
    execSync(`dpkg-deb -x "${tmpDeb}" "${extractDir}"`, { stdio: "pipe" });

    await rmForce(azDistDir);
    await fs.rename(path.join(extractDir, "opt", "az"), azDistDir);

    // Fix shebang (points to build-time path)
    const azScript = path.join(azDistDir, "bin", "az");
    const content = await fs.readFile(azScript, "utf8");
    await fs.writeFile(azScript, content.replace(/^#!.*/, "#!/usr/bin/env python3"), "utf8");
    chmodIfNeeded(azScript);

    const installedSha = await sha256(azScript);

    await setManifestEntry("az", {
      version: `v${target.version}`,
      file: "az-dist/bin/az",
      sha256: installedSha,
      mode: pinnedVer ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });

    console.log(`✓ az installed (v${target.version})`);
  } finally {
    await rmForce(tmpDeb);
    await rmForce(extractDir);
  }
}

/* =======================
   Sidecar wrapper compilation (gcloud-cli, az-cli)
======================= */

async function compileSidecarWrapper(wrapperName, sourceFile, outputName) {
  const platform = os.platform();
  const exe = platform === "win32" ? `${outputName}.exe` : outputName;
  const out = path.join(TARGET_DIR, exe);
  const src = path.join(PROJECT_ROOT, "src-tauri", "sidecar-wrappers", sourceFile);

  if (!(await fileExists(src))) {
    console.log(`  skipping ${wrapperName} wrapper (source ${sourceFile} not found)`);
    return;
  }

  // Skip if already compiled and up-to-date
  if (await fileExists(out)) {
    const srcStat = await fs.stat(src);
    const outStat = await fs.stat(out);
    if (outStat.mtimeMs > srcStat.mtimeMs) {
      chmodIfNeeded(out);
      await ensureTauriExternalBinName(out);
      console.log(`  cached: ${outputName} wrapper (up-to-date)`);
      return;
    }
  }

  // Try available C compilers in order of preference per platform
  const compilers =
    platform === "win32"
      ? [`gcc -O2 -o "${out}" "${src}"`, `cl /O2 /Fe:"${out}" "${src}"`]
      : platform === "darwin"
        ? [`clang -O2 -o "${out}" "${src}"`, `gcc -O2 -o "${out}" "${src}"`]
        : [`gcc -O2 -o "${out}" "${src}"`, `cc -O2 -o "${out}" "${src}"`];

  let compiled = false;
  for (const cmd of compilers) {
    try {
      execSync(cmd, { stdio: "pipe" });
      compiled = true;
      break;
    } catch {
      // try next compiler
    }
  }
  if (!compiled) {
    throw new Error(
      `Failed to compile ${wrapperName} wrapper: no C compiler found (tried: ${compilers.map((c) => c.split(" ")[0]).join(", ")})`,
    );
  }

  chmodIfNeeded(out);
  await ensureTauriExternalBinName(out);
  console.log(`  compiled: ${outputName} wrapper`);
}

async function compileSidecarWrappers() {
  console.log("\nCompiling sidecar wrappers...");
  // gcloud sidecar not compiled - SDK not bundled (Google ToS).
  // await compileSidecarWrapper("gcloud", "gcloud-wrapper.c", "rozoom-gcloud-cli");
  await compileSidecarWrapper("az", "az-wrapper.c", "rozoom-az-cli");
}

/* =======================
   curl (static binary from GitHub stunnel/static-curl)
======================= */

function extractTarXz(archive, outDir) {
  execSync(`tar -xJf "${archive}" -C "${outDir}" --no-same-owner`, { stdio: "inherit" });
}

async function installCurl() {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "x86_64" : "arm64";
  const ext = platform === "win32" ? ".exe" : "";
  const osName = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";

  const pinned = envOrNull("CURL_VERSION");
  const tag = pinned ? pinned.replace(/^v/, "") : await fetchLatestGitHubTag("stunnel/static-curl");

  const archName = platform === "linux" ? (os.arch() === "x64" ? "x86_64" : "aarch64") : arch;
  const variant = platform === "linux" ? `-musl` : "";
  const archiveName = `curl-${osName}-${archName}${variant}-${tag}.tar.xz`;
  const url = `https://github.com/stunnel/static-curl/releases/download/${tag}/${archiveName}`;
  const out = path.join(TARGET_DIR, `curl${ext}`);

  const cached = await getManifestEntry("curl");
  if (cached?.version === tag && (await fileExists(out))) {
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);
    console.log(`✓ cached: curl (${tag})`);
    return;
  }

  const tmp = path.join(TARGET_DIR, archiveName);
  const extractDir = path.join(TARGET_DIR, "curl-extract");
  try {
    const expected = await fetchReleaseChecksum("stunnel/static-curl", tag, archiveName);
    await download(url, tmp, UA_HEADERS);
    if (expected) {
      const actual = await sha256(tmp);
      if (actual !== expected) {
        throw new Error(`curl checksum mismatch\nexpected=${expected}\nactual=${actual}`);
      }
    } else {
      console.warn("⚠ curl: no upstream checksum asset - verification skipped");
    }
    await rmForce(extractDir);
    await fs.mkdir(extractDir, { recursive: true });
    await extractTarXz(tmp, extractDir);

    const bin = await locateBinaryInExtractDir(extractDir, [`curl${ext}`, "curl"]);
    if (!bin) throw new Error("curl binary not found in archive");
    await fs.copyFile(bin, out);
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);

    await setManifestEntry("curl", {
      version: tag,
      file: path.basename(out),
      sha256: await sha256(out),
      archiveSha256: expected ?? undefined,
      mode: pinned ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });
    console.log(`✓ curl installed (${tag})${expected ? "" : " [no upstream checksum]"}`);
  } finally {
    await rmForce(tmp);
    await rmForce(extractDir);
  }
}

/* =======================
   doggo - DNS client (GitHub mr-karan/doggo)
======================= */

async function installDoggo() {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "x86_64" : "arm64";
  const ext = platform === "win32" ? ".exe" : "";
  const osName = platform === "win32" ? "Windows" : platform === "darwin" ? "Darwin" : "Linux";

  const pinned = envOrNull("DOGGO_VERSION");
  const tag = pinned
    ? `v${pinned.replace(/^v/, "")}`
    : await fetchLatestGitHubTag("mr-karan/doggo");
  const ver = tag.replace(/^v/, "");
  const archiveName =
    platform === "win32"
      ? `doggo_${ver}_${osName}_${arch}.zip`
      : `doggo_${ver}_${osName}_${arch}.tar.gz`;

  const url = `https://github.com/mr-karan/doggo/releases/download/${tag}/${archiveName}`;
  const out = path.join(TARGET_DIR, `doggo${ext}`);

  const cached = await getManifestEntry("doggo");
  if (cached?.version === tag && (await fileExists(out))) {
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);
    console.log(`✓ cached: doggo (${tag})`);
    return;
  }

  const tmp = path.join(TARGET_DIR, archiveName);
  const extractDir = path.join(TARGET_DIR, "doggo-extract");
  try {
    const expected = await fetchReleaseChecksum("mr-karan/doggo", tag, archiveName);
    await download(url, tmp, UA_HEADERS);
    if (expected) {
      const actual = await sha256(tmp);
      if (actual !== expected) {
        throw new Error(`doggo checksum mismatch\nexpected=${expected}\nactual=${actual}`);
      }
    }
    await rmForce(extractDir);
    await fs.mkdir(extractDir, { recursive: true });
    if (tmp.endsWith(".zip")) await extractZip(tmp, { dir: extractDir });
    else await extractTarGz(tmp, extractDir);

    const bin = await locateBinaryInExtractDir(extractDir, [`doggo${ext}`, "doggo"]);
    if (!bin) throw new Error("doggo binary not found in archive");
    await fs.copyFile(bin, out);
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);

    await setManifestEntry("doggo", {
      version: tag,
      file: path.basename(out),
      sha256: await sha256(out),
      archiveSha256: expected ?? undefined,
      mode: pinned ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });
    console.log(`✓ doggo installed (${tag})${expected ? "" : " [no upstream checksum]"}`);
  } finally {
    await rmForce(tmp);
    await rmForce(extractDir);
  }
}

/* =======================
   grpcurl (GitHub fullstorydev/grpcurl)
======================= */

async function installGrpcurl() {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "x86_64" : "arm64";
  const ext = platform === "win32" ? ".exe" : "";
  const osName = platform === "win32" ? "windows" : platform === "darwin" ? "osx" : "linux";

  const pinned = envOrNull("GRPCURL_VERSION");
  const tag = pinned
    ? `v${pinned.replace(/^v/, "")}`
    : await fetchLatestGitHubTag("fullstorydev/grpcurl");
  const ver = tag.replace(/^v/, "");
  const archiveName =
    platform === "win32"
      ? `grpcurl_${ver}_${osName}_${arch}.zip`
      : `grpcurl_${ver}_${osName}_${arch}.tar.gz`;

  const url = `https://github.com/fullstorydev/grpcurl/releases/download/${tag}/${archiveName}`;
  const out = path.join(TARGET_DIR, `grpcurl${ext}`);

  const cached = await getManifestEntry("grpcurl");
  if (cached?.version === tag && (await fileExists(out))) {
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);
    console.log(`✓ cached: grpcurl (${tag})`);
    return;
  }

  const tmp = path.join(TARGET_DIR, archiveName);
  const extractDir = path.join(TARGET_DIR, "grpcurl-extract");
  try {
    const expected = await fetchReleaseChecksum("fullstorydev/grpcurl", tag, archiveName);
    await download(url, tmp, UA_HEADERS);
    if (expected) {
      const actual = await sha256(tmp);
      if (actual !== expected) {
        throw new Error(`grpcurl checksum mismatch\nexpected=${expected}\nactual=${actual}`);
      }
    }
    await rmForce(extractDir);
    await fs.mkdir(extractDir, { recursive: true });
    if (tmp.endsWith(".zip")) await extractZip(tmp, { dir: extractDir });
    else await extractTarGz(tmp, extractDir);

    const bin = await locateBinaryInExtractDir(extractDir, [`grpcurl${ext}`, "grpcurl"]);
    if (!bin) throw new Error("grpcurl binary not found in archive");
    await fs.copyFile(bin, out);
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);

    await setManifestEntry("grpcurl", {
      version: tag,
      file: path.basename(out),
      sha256: await sha256(out),
      archiveSha256: expected ?? undefined,
      mode: pinned ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });
    console.log(`✓ grpcurl installed (${tag})${expected ? "" : " [no upstream checksum]"}`);
  } finally {
    await rmForce(tmp);
    await rmForce(extractDir);
  }
}

/* =======================
   websocat (GitHub vi/websocat)
======================= */

async function installWebsocat() {
  const platform = os.platform();
  const arch = os.arch();
  const ext = platform === "win32" ? ".exe" : "";

  const pinned = envOrNull("WEBSOCAT_VERSION");
  const tag = pinned ? `v${pinned.replace(/^v/, "")}` : await fetchLatestGitHubTag("vi/websocat");

  let assetName;
  if (platform === "win32") {
    assetName = "websocat.x86_64-pc-windows-gnu.exe";
  } else if (platform === "darwin") {
    assetName = arch === "arm64" ? "websocat.aarch64-apple-darwin" : "websocat.x86_64-apple-darwin";
  } else {
    assetName =
      arch === "arm64"
        ? "websocat.aarch64-unknown-linux-musl"
        : "websocat.x86_64-unknown-linux-musl";
  }

  const url = `https://github.com/vi/websocat/releases/download/${tag}/${assetName}`;
  const out = path.join(TARGET_DIR, `websocat${ext}`);

  const cached = await getManifestEntry("websocat");
  if (cached?.version === tag && (await fileExists(out))) {
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);
    console.log(`✓ cached: websocat (${tag})`);
    return;
  }

  const expected = await fetchReleaseChecksum("vi/websocat", tag, assetName);
  await download(url, out, UA_HEADERS);
  const actual = await sha256(out);
  if (expected && actual !== expected) {
    throw new Error(`websocat checksum mismatch\nexpected=${expected}\nactual=${actual}`);
  }
  if (!expected) {
    console.warn("⚠ websocat: no upstream checksum asset - verification skipped");
  }
  chmodIfNeeded(out);
  await ensureTauriExternalBinName(out);

  await setManifestEntry("websocat", {
    version: tag,
    file: path.basename(out),
    sha256: actual,
    archiveSha256: expected ?? undefined,
    mode: pinned ? "pin" : "latest",
    updatedAt: new Date().toISOString(),
  });
  console.log(`✓ websocat installed (${tag})${expected ? "" : " [no upstream checksum]"}`);
}

/* =======================
   tcping (GitHub cloverstd/tcping)
======================= */

async function installTcping() {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "amd64" : "arm64";
  const ext = platform === "win32" ? ".exe" : "";
  const osName = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";

  const pinned = envOrNull("TCPING_VERSION");
  const tag = pinned
    ? `v${pinned.replace(/^v/, "")}`
    : await fetchLatestGitHubTag("cloverstd/tcping");

  const archiveName = `tcping-${osName}-${arch}-${tag}.tar.gz`;
  const url = `https://github.com/cloverstd/tcping/releases/download/${tag}/${archiveName}`;
  const out = path.join(TARGET_DIR, `tcping${ext}`);

  const cached = await getManifestEntry("tcping");
  if (cached?.version === tag && (await fileExists(out))) {
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);
    console.log(`✓ cached: tcping (${tag})`);
    return;
  }

  const tmp = path.join(TARGET_DIR, archiveName);
  const extractDir = path.join(TARGET_DIR, "tcping-extract");
  try {
    const expected = await fetchReleaseChecksum("cloverstd/tcping", tag, archiveName);
    await download(url, tmp, UA_HEADERS);
    if (expected) {
      const actual = await sha256(tmp);
      if (actual !== expected) {
        throw new Error(`tcping checksum mismatch\nexpected=${expected}\nactual=${actual}`);
      }
    } else {
      console.warn("⚠ tcping: no upstream checksum asset - verification skipped");
    }
    await rmForce(extractDir);
    await fs.mkdir(extractDir, { recursive: true });
    await extractTarGz(tmp, extractDir);

    const bin = await locateBinaryInExtractDir(extractDir, [`tcping${ext}`, "tcping"]);
    if (!bin) throw new Error("tcping binary not found in archive");
    await fs.copyFile(bin, out);
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);

    await setManifestEntry("tcping", {
      version: tag,
      file: path.basename(out),
      sha256: await sha256(out),
      archiveSha256: expected ?? undefined,
      mode: pinned ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });
    console.log(`✓ tcping installed (${tag})${expected ? "" : " [no upstream checksum]"}`);
  } finally {
    await rmForce(tmp);
    await rmForce(extractDir);
  }
}

/* =======================
   trivy (GitHub aquasecurity/trivy)
======================= */

async function installTrivy() {
  const platform = os.platform();
  const arch = os.arch() === "x64" ? "64bit" : "ARM64";
  const ext = platform === "win32" ? ".exe" : "";
  const osName = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";

  const pinned = envOrNull("TRIVY_VERSION");
  const tag = pinned
    ? `v${pinned.replace(/^v/, "")}`
    : await fetchLatestGitHubTag("aquasecurity/trivy");
  const ver = tag.replace(/^v/, "");
  const archiveName =
    platform === "win32"
      ? `trivy_${ver}_${osName}-${arch}.zip`
      : `trivy_${ver}_${osName}-${arch}.tar.gz`;

  const url = `https://github.com/aquasecurity/trivy/releases/download/${tag}/${archiveName}`;
  const out = path.join(TARGET_DIR, `trivy${ext}`);

  const cached = await getManifestEntry("trivy");
  if (cached?.version === tag && (await fileExists(out))) {
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);
    console.log(`✓ cached: trivy (${tag})`);
    return;
  }

  const tmp = path.join(TARGET_DIR, archiveName);
  const extractDir = path.join(TARGET_DIR, "trivy-extract");
  try {
    const expected = await fetchReleaseChecksum("aquasecurity/trivy", tag, archiveName);
    await download(url, tmp, UA_HEADERS);
    if (expected) {
      const actual = await sha256(tmp);
      if (actual !== expected) {
        throw new Error(`trivy checksum mismatch\nexpected=${expected}\nactual=${actual}`);
      }
    }
    await rmForce(extractDir);
    await fs.mkdir(extractDir, { recursive: true });
    if (tmp.endsWith(".zip")) await extractZip(tmp, { dir: extractDir });
    else await extractTarGz(tmp, extractDir);

    const bin = await locateBinaryInExtractDir(extractDir, [`trivy${ext}`, "trivy"]);
    if (!bin) throw new Error("trivy binary not found in archive");
    await fs.copyFile(bin, out);
    chmodIfNeeded(out);
    await ensureTauriExternalBinName(out);

    await setManifestEntry("trivy", {
      version: tag,
      file: path.basename(out),
      sha256: await sha256(out),
      archiveSha256: expected ?? undefined,
      mode: pinned ? "pin" : "latest",
      updatedAt: new Date().toISOString(),
    });
    console.log(`✓ trivy installed (${tag})${expected ? "" : " [no upstream checksum]"}`);
  } finally {
    await rmForce(tmp);
    await rmForce(extractDir);
  }
}

/* =======================
   Prefix sidecar binaries with "rozoom-" to avoid /usr/bin conflicts
======================= */

const SIDECAR_TOOLS = [
  "kubectl",
  "helm",
  "doctl",
  "pluto",
  "velero",
  "kustomize",
  "kubeconform",
  "stern",
  "yq",
  "hcloud",
  "oc",
  "curl",
  "doggo",
  "grpcurl",
  "websocat",
  "tcping",
  "trivy",
];

async function prefixSidecarBinaries() {
  const triple = getTargetTriple();
  const platform = os.platform();
  const ext = platform === "win32" ? ".exe" : "";

  console.log("\nPrefixing sidecar binaries with rozoom-...");
  for (const tool of SIDECAR_TOOLS) {
    if (!isToolEnabled(tool)) continue;

    const src = path.join(TARGET_DIR, `${tool}${ext}`);
    const dst = path.join(TARGET_DIR, `rozoom-${tool}${ext}`);

    if (!(await fileExists(src))) continue;

    await fs.copyFile(src, dst);
    chmodIfNeeded(dst);
    await ensureTauriExternalBinName(dst);

    // Clean up unprefixed files (keep only rozoom-* versions)
    await rmForce(src);
    const srcTriple = path.join(TARGET_DIR, `${tool}-${triple}${ext}`);
    await rmForce(srcTriple);

    console.log(`  ${tool} -> rozoom-${tool}`);
  }
}

/* =======================
   Runner
======================= */

(async () => {
  await fs.mkdir(TARGET_DIR, { recursive: true });

  console.log("🚀 Installing CLI tools with checksum verification\n");
  if (ENABLED_TOOLS) {
    console.log(`ℹ️ VITE_ROZOOM_TOOLS=${ROZOOM_TOOLS_CSV}`);
    console.log(`   Only installing: ${[...ENABLED_TOOLS].join(", ")}\n`);
  } else {
    console.log("ℹ️ All tools enabled (set VITE_ROZOOM_TOOLS to limit)\n");
  }

  const run = (name, fn) => (isToolEnabled(name) ? fn() : null);

  await run("kubectl", installKubectl);
  await run("helm", installHelm);
  await run("doctl", installDoctl);
  await run("pluto", installPluto);
  await run("velero", installVelero);
  // gcloud SDK not bundled due to Google Cloud SDK ToS restrictions.
  // Users install gcloud separately. Only gke-gcloud-auth-plugin (Apache 2.0) is referenced.
  // await run("gcloud", installGcloudArchive);
  await run("aws", installAws);
  await run("kustomize", installKustomize);
  await run("kubeconform", installKubeconform);
  await run("stern", installStern);
  await run("yq", installYq);
  await run("hcloud", installHcloud);
  await run("oc", installOc);

  await run("az", installAzCli);
  await run("curl", installCurl);
  await run("doggo", installDoggo);
  await run("grpcurl", installGrpcurl);
  await run("websocat", installWebsocat);
  await run("tcping", installTcping);
  await run("trivy", installTrivy);

  // Compile sidecar wrappers (gcloud-cli, az-cli) for the current platform
  if (isToolEnabled("gcloud") || isToolEnabled("az")) {
    await compileSidecarWrappers();
  }

  // Prefix all sidecar binaries with "rozoom-" to avoid /usr/bin conflicts
  await prefixSidecarBinaries();

  await copyManifestToStatic();

  console.log("\n✅ All done");
})().catch((e) => {
  console.error("❌ Failed:", e.message);
  process.exit(1);
});
