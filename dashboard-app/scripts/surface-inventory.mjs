#!/usr/bin/env node
/* global console, URL */
/**
 * UI surface inventory (audit wave W0b).
 *
 * Walks the three source-of-truth registries and the action-menu components,
 * and emits a single JSON document describing the whole UI surface:
 *
 *   plugin -> screens (workload pages) -> sections -> visibility
 *   actions-menu components -> action props -> wired call sites
 *
 * Modes:
 *   node scripts/surface-inventory.mjs            # print JSON to stdout
 *   node scripts/surface-inventory.mjs --write    # update surface-inventory.json
 *   node scripts/surface-inventory.mjs --check    # CI gate: fail on drift or
 *                                                 # structural violations
 *
 * The committed surface-inventory.json is the declared baseline. --check
 * fails when the generated inventory differs (undeclared surface change) or
 * when a structural invariant is violated:
 *   - a screen loader key not claimed by any plugin page nor section registry
 *   - a plugin page id with no screen loader behind it
 *   - duplicate page ids across plugins
 *   - a section declared but owning zero pages
 *   - an action prop of a used actions-menu that is wired nowhere
 */

import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "src");
const REGISTRY = path.join(SRC, "lib/shared/plugins/registry.ts");
const ROUTE_REGISTRY = path.join(SRC, "lib/widgets/workload/model/workload-route-registry.ts");
const SECTION_REGISTRY = path.join(
  SRC,
  "lib/features/section-runtime/model/section-family-registry.ts",
);
const WORKLOAD_OPTIONS = path.join(SRC, "lib/pages/cluster/model/cluster-page-workload-config.ts");
const BASELINE = path.join(ROOT, "surface-inventory.json");

function parseSource(filePath) {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

/** Evaluate a restricted literal AST node (strings, numbers, booleans, arrays, objects). */
function literalValue(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literalValue);
  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key =
          ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name) ? prop.name.text : null;
        if (key) out[key] = literalValue(prop.initializer);
      }
    }
    return out;
  }
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return literalValue(node.expression);
  }
  return undefined;
}

function findTopLevelConst(sourceFile, name) {
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
        return decl.initializer;
      }
    }
  }
  throw new Error(`const ${name} not found in ${sourceFile.fileName}`);
}

function readPlugins() {
  const source = parseSource(REGISTRY);
  const plugins = literalValue(findTopLevelConst(source, "BUILTIN_PLUGINS"));
  if (!Array.isArray(plugins) || plugins.length === 0) {
    throw new Error("BUILTIN_PLUGINS parsed empty - registry.ts shape changed");
  }
  return plugins.map((p) => ({
    id: p.id,
    name: p.name,
    tier: p.tier,
    category: p.category,
    defaultDisabled: Boolean(p.defaultDisabled),
    pages: (p.provides?.workloadPages ?? []).map((page) => ({
      id: page.id,
      label: page.label,
      section: page.section ?? null,
    })),
  }));
}

function readScreenLoaders() {
  const source = parseSource(ROUTE_REGISTRY);
  const init = findTopLevelConst(source, "workloadComponentLoaders");
  if (!ts.isObjectLiteralExpression(init)) {
    throw new Error("workloadComponentLoaders is not an object literal");
  }
  const screens = [];
  for (const prop of init.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = prop.name.text;
    let importPath = null;
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        importPath = node.arguments[0]?.text ?? null;
      }
      ts.forEachChild(node, visit);
    };
    visit(prop.initializer);
    screens.push({ key, component: importPath });
  }
  if (screens.length === 0) throw new Error("workloadComponentLoaders parsed empty");
  return screens;
}

function readSectionDescriptors() {
  const source = parseSource(SECTION_REGISTRY);
  const init = findTopLevelConst(source, "SECTION_RUNTIME_DESCRIPTORS");
  const descriptors = literalValue(init) ?? {};
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, d]) => [key, { family: d.family ?? null }]),
  );
}

function readWorkspaceOptions() {
  const source = parseSource(WORKLOAD_OPTIONS);
  const options = literalValue(findTopLevelConst(source, "WORKSPACE_WORKLOAD_OPTIONS"));
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error("WORKSPACE_WORKLOAD_OPTIONS parsed empty");
  }
  return options.map((o) => ({ value: o.value, label: o.label, group: o.group ?? null }));
}

function readClusterHealthWorkloads() {
  const source = parseSource(WORKLOAD_OPTIONS);
  const keys = literalValue(findTopLevelConst(source, "CLUSTER_HEALTH_WORKLOADS"));
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error("CLUSTER_HEALTH_WORKLOADS parsed empty");
  }
  return new Set(keys);
}

function resolveComponentFile(importPath) {
  if (!importPath) return null;
  const mapped = importPath.replace(/^\$widgets\//, "lib/widgets/");
  const abs = path.join(SRC, mapped);
  return existsSync(abs) ? mapped : null;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Action surface: every `on<Name>` callback prop declared by an actions-menu
 * component, plus whether any call site in src/ wires it. Optional props
 * default to a noop in the components, so an unwired optional prop is a
 * menu item whose handler silently does nothing.
 */
function readActionSurface(allSourceFiles) {
  const menus = allSourceFiles.filter(
    (f) => f.endsWith(".svelte") && /(actions-menu|bulk-actions)\.svelte$/.test(f),
  );
  const nonMenuSources = allSourceFiles.filter(
    (f) =>
      /\.(svelte|ts)$/.test(f) &&
      !/(actions-menu|bulk-actions)\.svelte$/.test(f) &&
      !f.endsWith(".test.ts"),
  );
  const corpus = nonMenuSources.map((f) => readFileSync(f, "utf8"));

  const result = [];
  for (const menu of menus) {
    const text = readFileSync(menu, "utf8");
    const props = [];
    const propRe = /^\s*(on[A-Z]\w*)(\?)?:\s*\(/gm;
    let m;
    while ((m = propRe.exec(text)) !== null) {
      props.push({ name: m[1], optional: Boolean(m[2]) });
    }
    if (props.length === 0) continue;
    const actions = props.map((p) => {
      const wireRe = new RegExp(`${p.name}\\s*[:=]`);
      const wired = corpus.some((c) => wireRe.test(c));
      return { name: p.name, optional: p.optional, wired };
    });
    result.push({ component: path.relative(SRC, menu), actions });
  }
  result.sort((a, b) => a.component.localeCompare(b.component));
  return result;
}

export function buildInventory() {
  const plugins = readPlugins();
  const screenLoaders = readScreenLoaders();
  const sectionDescriptors = readSectionDescriptors();
  const workspaceOptions = readWorkspaceOptions();
  const optionByValue = new Map(workspaceOptions.map((o) => [o.value, o]));
  const clusterHealthKeys = readClusterHealthWorkloads();
  const allSourceFiles = walk(SRC);
  const actionMenus = readActionSurface(allSourceFiles);

  const pageOwner = new Map();
  const duplicatePageIds = [];
  for (const plugin of plugins) {
    for (const page of plugin.pages) {
      if (pageOwner.has(page.id)) {
        duplicatePageIds.push({ page: page.id, plugins: [pageOwner.get(page.id), plugin.id] });
      } else {
        pageOwner.set(page.id, plugin.id);
      }
    }
  }

  const screens = screenLoaders.map(({ key, component }) => {
    const ownerId = pageOwner.get(key) ?? null;
    const owner = plugins.find((p) => p.id === ownerId) ?? null;
    const option = optionByValue.get(key) ?? null;
    const section =
      owner?.pages.find((p) => p.id === key)?.section ??
      sectionDescriptors[key]?.family ??
      option?.group ??
      null;
    return {
      key,
      label: option?.label ?? owner?.pages.find((p) => p.id === key)?.label ?? null,
      component: resolveComponentFile(component),
      plugin: ownerId,
      section,
      // Mirrors isMenuKeyVisible(): no owning plugin or core tier => always
      // visible; otherwise gated by the marketplace toggle.
      visibility:
        !owner || owner.tier === "core"
          ? "always"
          : owner.defaultDisabled
            ? "plugin-gated (off by default)"
            : "plugin-gated",
    };
  });

  const screenKeys = new Set(screens.map((s) => s.key));
  const violations = [];

  for (const [pageId, pluginId] of pageOwner) {
    if (!screenKeys.has(pageId)) {
      violations.push(`plugin page without screen loader: ${pluginId}/${pageId}`);
    }
  }
  for (const screen of screens) {
    if (
      !screen.plugin &&
      !(screen.key in sectionDescriptors) &&
      !optionByValue.has(screen.key) &&
      !clusterHealthKeys.has(screen.key)
    ) {
      violations.push(`orphan screen (declared in no registry): ${screen.key}`);
    }
    if (!screen.component) {
      violations.push(`screen loader points at a missing component: ${screen.key}`);
    }
  }
  for (const option of workspaceOptions) {
    if (!screenKeys.has(option.value)) {
      violations.push(`workspace option without screen loader: ${option.value}`);
    }
  }
  const labelSeen = new Map();
  for (const option of workspaceOptions) {
    const labelKey = `${option.group ?? ""}::${option.label}`;
    if (labelSeen.has(labelKey)) {
      violations.push(`duplicate label in group: "${option.label}" (${option.group})`);
    }
    labelSeen.set(labelKey, option.value);
  }
  for (const dup of duplicatePageIds) {
    violations.push(`duplicate page id across plugins: ${dup.page} (${dup.plugins.join(", ")})`);
  }
  const sectionCounts = new Map();
  for (const screen of screens) {
    if (screen.section)
      sectionCounts.set(screen.section, (sectionCounts.get(screen.section) ?? 0) + 1);
  }
  for (const plugin of plugins) {
    for (const page of plugin.pages) {
      if (page.section && !sectionCounts.has(page.section)) {
        violations.push(`empty section: ${page.section}`);
      }
    }
  }
  for (const menu of actionMenus) {
    for (const action of menu.actions) {
      if (!action.wired) {
        violations.push(`action prop wired nowhere: ${menu.component} -> ${action.name}`);
      }
    }
  }

  const totals = {
    plugins: plugins.length,
    screens: screens.length,
    sections: sectionCounts.size,
    actionMenus: actionMenus.length,
    actions: actionMenus.reduce((n, menu) => n + menu.actions.length, 0),
    orphanScreens: screens.filter(
      (s) =>
        !s.plugin &&
        !(s.key in sectionDescriptors) &&
        !optionByValue.has(s.key) &&
        !clusterHealthKeys.has(s.key),
    ).length,
  };

  return {
    $comment:
      "Generated by scripts/surface-inventory.mjs. Do not edit by hand: run `pnpm run surface:write` after an intentional surface change.",
    totals,
    plugins,
    screens,
    actionMenus,
    violations: violations.sort(),
  };
}

export function stable(json) {
  return JSON.stringify(json, null, 2) + "\n";
}

function main() {
  const mode = process.argv[2] ?? "--print";
  const inventory = buildInventory();

  if (mode === "--write") {
    writeFileSync(BASELINE, stable(inventory));
    console.log(`surface-inventory.json updated: ${JSON.stringify(inventory.totals)}`);
  } else if (mode === "--check") {
    let failed = false;
    if (inventory.violations.length > 0) {
      console.error("Surface invariant violations:");
      for (const v of inventory.violations) console.error(`  - ${v}`);
      failed = true;
    }
    if (!existsSync(BASELINE)) {
      console.error("surface-inventory.json is missing. Run: pnpm run surface:write");
      failed = true;
    } else {
      const committed = readFileSync(BASELINE, "utf8");
      if (committed !== stable(inventory)) {
        console.error(
          "UI surface changed but surface-inventory.json was not updated.\n" +
            "If the change is intentional, run `pnpm run surface:write` and commit the diff.",
        );
        failed = true;
      }
    }
    if (failed) process.exit(1);
    console.log(`surface check OK: ${JSON.stringify(inventory.totals)}`);
  } else {
    process.stdout.write(stable(inventory));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main();
}
