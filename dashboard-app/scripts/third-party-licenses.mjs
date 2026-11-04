#!/usr/bin/env node
/* global console, process, URL */
/**
 * Third-party license inventory.
 *
 * Builds THIRD-PARTY-LICENSES.md at the repository root from everything the
 * released app carries that is not ours:
 *
 *   - the command-line tools bundled as sidecars and resources
 *     (static/binaries/install-manifest.json for the versions,
 *     third-party/tools.json for upstream and license, third-party/tools/<tool>/
 *     for the license texts taken from upstream);
 *   - the production npm dependencies of the web app (pnpm licenses);
 *   - the Rust crates of the Tauri shell (cargo metadata);
 *   - the text of every license those dependencies are under
 *     (third-party/spdx/<ID>.txt).
 *
 * Modes:
 *   node scripts/third-party-licenses.mjs --write              # regenerate the file
 *   node scripts/third-party-licenses.mjs --check              # fail on drift
 *   node scripts/third-party-licenses.mjs --check --skip-cargo # same, without a
 *                                                              # Rust toolchain:
 *                                                              # the crate table
 *                                                              # is carried over
 *                                                              # from the file
 *
 * The release workflow regenerates the file after the binaries are downloaded,
 * so the copy inside the bundle names the versions that were actually bundled.
 * A dependency under a license with no text in third-party/spdx/ fails the run:
 * add the text, then regenerate.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Not URL.pathname: on Windows that is "/D:/a/..." and path.resolve turns it
// into a path on the wrong drive.
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_DIR = path.resolve(APP_DIR, "..");
// pnpm is a .cmd shim on Windows, which Node only spawns through a shell.
// The arguments passed below carry no shell metacharacters.
const SPAWN_SHELL = process.platform === "win32";
const OUTPUT = path.join(REPO_DIR, "THIRD-PARTY-LICENSES.md");
const MANIFEST = path.join(APP_DIR, "static", "binaries", "install-manifest.json");
const TOOLS_TABLE = path.join(REPO_DIR, "third-party", "tools.json");
const TOOLS_DIR = path.join(REPO_DIR, "third-party", "tools");
const SPDX_DIR = path.join(REPO_DIR, "third-party", "spdx");
const CARGO_START = "<!-- cargo:start -->";
const CARGO_END = "<!-- cargo:end -->";

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function fence(text) {
  // A text that itself contains a fence needs a longer one around it.
  const marks = text.includes("```") ? "````" : "```";
  return `${marks}text\n` + text.replace(/\s+$/, "") + `\n${marks}\n`;
}

function cell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

function table(header, rows) {
  const line = (cells) => `| ${cells.map(cell).join(" | ")} |`;
  return (
    [line(header), `|${header.map(() => " --- ").join("|")}|`, ...rows.map(line)].join("\n") + "\n"
  );
}

/** First copyright line of a LICENSE-like file in `dir`, or "". */
function copyrightLine(dir) {
  if (!dir || !existsSync(dir)) return "";
  const files = readdirSync(dir).filter((f) => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(f));
  for (const f of files.sort()) {
    const full = path.join(dir, f);
    let text;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split("\n")) {
      const line = raw
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[#*\-\s]+/, "");
      // A notice names a holder: "Copyright (c) 2019 Name" or "Copyright 2019 Name".
      // Lines that merely use the word, like the Apache definitions, do not count,
      // nor do the placeholders of the Apache template.
      if (
        !/^copyright\s*(\(c\)|©)?\s*\d{4}/i.test(line) &&
        !/^copyright\s*(\(c\)|©)\s*\S/i.test(line)
      )
        continue;
      if (/\[yyyy\]|\[name of copyright owner\]/i.test(line)) continue;
      return line.slice(0, 160);
    }
  }
  return "";
}

/** SPDX identifiers used in a license expression such as "MIT OR Apache-2.0". */
function identifiers(expression) {
  return String(expression)
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND|WITH)\s+|\//i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function versionPlaceholders(version) {
  const bare = version.replace(/^v/, "");
  return { version, bare, underscored: bare.replace(/\./g, "_") };
}

function fillTemplate(template, version) {
  const values = versionPlaceholders(version);
  return template.replace(/\{(version|bare|underscored)\}/g, (_, key) => values[key]);
}

/* -------------------------------------------------------------------------- */
/* Bundled tools                                                               */
/* -------------------------------------------------------------------------- */

/**
 * @param {boolean} strict  `--check` compares against the committed reference manifest,
 *   where every tool in third-party/tools.json must be present. The release build
 *   (`--write`) runs right after `download:binaries`, whose manifest names only what
 *   was actually installed: an optional resource that is Linux-only (aws) or whose
 *   install stalled is replaced by an empty stub and has no manifest entry. Nothing
 *   of it ships, so there is nothing to license: warn and leave the row out instead
 *   of failing the release on every platform.
 */
function toolsSection(strict) {
  const manifest = readJson(MANIFEST).tools ?? {};
  const tools = readJson(TOOLS_TABLE).tools;
  const names = Object.keys(tools).sort();
  // A shipped tool without a license entry is always an error, in both modes.
  const missing = Object.keys(manifest).filter((k) => !tools[k] && k !== "gcloud");
  if (missing.length) {
    throw new Error(
      `install-manifest.json has tools without an entry in third-party/tools.json: ${missing.join(", ")}`,
    );
  }

  const rows = [];
  const details = [];
  // Many tools ship the same verbatim license text; print it once and refer
  // back to the first tool that carried it.
  const seenTexts = new Map();
  for (const key of names) {
    const tool = tools[key];
    const entry = manifest[key];
    if (!entry) {
      const problem = `third-party/tools.json lists "${key}" but install-manifest.json has no such tool`;
      if (strict) throw new Error(problem);
      console.warn(`::warning::${problem}; not bundled in this build, left out of the tools table`);
      continue;
    }
    const version = entry.version;
    const source = fillTemplate(tool.sourceUrl, version);
    const bundle = tool.variants.includes("slim") ? "full, slim" : "full";
    rows.push([tool.name, version, bundle, tool.license, `[source](${source})`]);

    const dir = path.join(TOOLS_DIR, key);
    const files = existsSync(dir) ? readdirSync(dir).sort() : [];
    if (!files.includes("LICENSE")) throw new Error(`third-party/tools/${key}/LICENSE is missing`);
    let block = `### ${tool.name} ${version}\n\n`;
    block += `Upstream: ${tool.upstream}  \nSource for this version: ${source}  \nLicense: ${tool.license}`;
    if (tool.bundledAs) block += `  \nBundled as: ${tool.bundledAs}`;
    block += "\n\n";
    if (tool.note) block += `${tool.note}\n\n`;
    for (const f of files) {
      const label = f === "LICENSE" ? "License text" : f === "NOTICE" ? "NOTICE" : f;
      const text = readFileSync(path.join(dir, f), "utf8");
      const normalized = text.replace(/\s+/g, " ").trim();
      const first = seenTexts.get(normalized);
      if (first) {
        block += `${label}: identical to the text under ${first}.\n\n`;
      } else {
        seenTexts.set(normalized, `${tool.name} ${version}`);
        block += `${label}:\n\n${fence(text)}\n`;
      }
    }
    details.push(block);
  }

  const gcloudNote = manifest.gcloud
    ? "The Google Cloud CLI appears in the download manifest but is not bundled: it is neither a sidecar nor a resource of the app.\n\n"
    : "";
  return (
    "## Bundled command-line tools\n\n" +
    "The desktop app ships these tools as separate executables and runs them as subprocesses. " +
    "The slim bundle carries only kubectl and Helm; the full bundle carries all of them. " +
    "Each tool is distributed unmodified under its own license, reproduced below.\n\n" +
    gcloudNote +
    table(["Tool", "Version", "Bundle", "License", "Source"], rows) +
    "\n" +
    details.join("\n")
  );
}

/* -------------------------------------------------------------------------- */
/* npm                                                                         */
/* -------------------------------------------------------------------------- */

function npmPackages() {
  const raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
    cwd: APP_DIR,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    shell: SPAWN_SHELL,
  });
  const byLicense = JSON.parse(raw);
  const packages = [];
  for (const entries of Object.values(byLicense)) {
    for (const e of entries) {
      packages.push({
        name: e.name,
        version: (e.versions ?? []).join(", "),
        license: e.license,
        copyright: copyrightLine(e.paths?.[0]) || (e.author ? `Author: ${e.author}` : ""),
        homepage: e.homepage ?? "",
      });
    }
  }
  packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return packages;
}

function npmSection(packages) {
  const rows = packages.map((p) => [
    p.homepage ? `[${p.name}](${p.homepage})` : p.name,
    p.version,
    p.license,
    p.copyright,
  ]);
  return (
    "## JavaScript packages\n\n" +
    `Production dependencies of the web app (dashboard-app), ${packages.length} packages, as reported by \`pnpm licenses list --prod\`. ` +
    "Development-only packages are not part of the released app and are not listed.\n\n" +
    table(["Package", "Version", "License", "Copyright"], rows)
  );
}

/* -------------------------------------------------------------------------- */
/* cargo                                                                       */
/* -------------------------------------------------------------------------- */

function cargoCrates() {
  const raw = execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], {
    cwd: path.join(APP_DIR, "src-tauri"),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
    shell: SPAWN_SHELL,
  });
  const meta = JSON.parse(raw);
  const workspace = new Set(meta.workspace_members);
  const crates = meta.packages
    .filter((p) => !workspace.has(p.id))
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? (p.license_file ? `see ${p.license_file}` : "UNKNOWN"),
      repository: p.repository ?? "",
      copyright:
        copyrightLine(path.dirname(p.manifest_path)) ||
        (p.authors?.length
          ? `Authors: ${p.authors.map((a) => a.replace(/\s*<[^>]*>/g, "")).join(", ")}`
          : ""),
    }));
  crates.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return crates;
}

function cargoSection(crates) {
  const rows = crates.map((c) => [
    c.repository ? `[${c.name}](${c.repository})` : c.name,
    c.version,
    c.license,
    c.copyright,
  ]);
  return (
    `${CARGO_START}\n## Rust crates\n\n` +
    `Dependencies of the Tauri shell (dashboard-app/src-tauri), ${crates.length} crates, as reported by \`cargo metadata\`. ` +
    "A crate listed with several licenses may be used under any one of them.\n\n" +
    table(["Crate", "Version", "License", "Copyright"], rows) +
    `${CARGO_END}\n`
  );
}

/** Reuse the crate section of the committed file when no Rust toolchain is at hand. */
function carriedCargoSection(existing) {
  const start = existing.indexOf(CARGO_START);
  const end = existing.indexOf(CARGO_END);
  if (start < 0 || end < 0)
    throw new Error(`--skip-cargo needs an existing ${path.basename(OUTPUT)} with a crate section`);
  return existing.slice(start, end + CARGO_END.length) + "\n";
}

function licensesInTable(section) {
  // Third column of every table row: "| name | version | license | copyright |"
  const found = new Set();
  for (const line of section.split("\n")) {
    const m = line.match(/^\|[^|]*\|[^|]*\|([^|]*)\|/);
    if (m && !/^\s*-+\s*$/.test(m[1]) && m[1].trim() !== "License") found.add(m[1].trim());
  }
  return [...found];
}

/* -------------------------------------------------------------------------- */
/* License texts                                                               */
/* -------------------------------------------------------------------------- */

function spdxSection(expressions) {
  const ids = new Set();
  for (const e of expressions) for (const id of identifiers(e)) ids.add(id);
  const sorted = [...ids].sort();
  const missing = sorted.filter((id) => !existsSync(path.join(SPDX_DIR, `${id}.txt`)));
  if (missing.length) {
    throw new Error(
      `no license text for ${missing.join(", ")}: add third-party/spdx/<ID>.txt (https://spdx.org/licenses/) and regenerate`,
    );
  }
  let out =
    "## License texts\n\n" +
    "Standard texts of the licenses named in the package and crate tables above, by SPDX identifier. " +
    "The copyright holders are the ones named in each table row.\n\n";
  for (const id of sorted) {
    out += `### ${id}\n\n${fence(readFileSync(path.join(SPDX_DIR, `${id}.txt`), "utf8"))}\n`;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                        */
/* -------------------------------------------------------------------------- */

function generate({ skipCargo, existing, strict }) {
  const packages = npmPackages();
  const cargo = skipCargo ? carriedCargoSection(existing) : cargoSection(cargoCrates());
  const expressions = [...packages.map((p) => p.license), ...licensesInTable(cargo)];
  const manifest = readJson(MANIFEST).tools ?? {};
  const snapshot = Object.values(manifest)
    .map((t) => t.updatedAt ?? "")
    .sort()
    .at(-1);

  return (
    "# Third-party licenses\n\n" +
    "ROZOOM K8s Linter IDE is licensed under the Apache License 2.0 (see LICENSE). " +
    "This file lists the third-party software the released app contains and the licenses it is distributed under.\n\n" +
    "Generated by `dashboard-app/scripts/third-party-licenses.mjs`; do not edit by hand. " +
    "Regenerate with `pnpm run licenses:write` in dashboard-app. " +
    `Tool versions are those of the binaries manifest (last resolved ${snapshot || "unknown"}); ` +
    "the release build regenerates this file after downloading the binaries, so the copy inside the installer names the bundled versions.\n\n" +
    toolsSection(strict) +
    "\n" +
    npmSection(packages) +
    "\n" +
    cargo +
    "\n" +
    spdxSection(expressions)
  );
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.find((a) => a === "--write" || a === "--check") ?? "--check";
  const skipCargo = args.includes("--skip-cargo");
  const existing = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
  const content = generate({ skipCargo, existing, strict: mode === "--check" });

  if (mode === "--write") {
    writeFileSync(OUTPUT, content);
    console.log(`wrote ${path.relative(REPO_DIR, OUTPUT)} (${content.length} chars)`);
    return;
  }
  if (content === existing) {
    console.log(
      `${path.relative(REPO_DIR, OUTPUT)} is up to date${skipCargo ? " (crate table carried over)" : ""}`,
    );
    return;
  }
  const a = existing.split("\n");
  const b = content.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.error(
    `${path.relative(REPO_DIR, OUTPUT)} is out of date; first difference at line ${i + 1}:`,
  );
  console.error(`  committed: ${a[i] ?? "<end of file>"}`);
  console.error(`  generated: ${b[i] ?? "<end of file>"}`);
  console.error("Run `pnpm run licenses:write` in dashboard-app and commit the result.");
  process.exit(1);
}

main();
