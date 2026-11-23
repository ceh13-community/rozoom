import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every Download and Export button saves through save-export.ts (the app's save_download
// command), which writes only a plain new file in the Downloads folder and tells the user where
// it went or why it failed. Any other way into Downloads saves silently or past those checks.
const SRC = resolve(__dirname, "../../..");

const SAVE_PATHS: { what: string; pattern: RegExp; allowed: string[] }[] = [
  {
    what: "a Downloads path from the fs plugin or the path API (any import alias)",
    pattern: /\.Download\b|\bdownloadDir\s*\(/,
    // YAML backups keep a folder under Downloads/rozoom that they list, read and delete; the
    // fs scope allows only that folder.
    allowed: ["lib/features/yaml-backup/model/backup-api.ts"],
  },
  {
    what: "the save_download command called directly",
    pattern: /save_download/,
    allowed: ["lib/shared/lib/text-export.ts"],
  },
  {
    what: "a browser download link (blob or data URL, download attribute)",
    pattern:
      /createObjectURL\s*\(|\.download\s*=|setAttribute\(\s*["']download["']|["'`]data:[\w.+-]+\/[\w.+-]+[;,]/,
    allowed: ["lib/shared/lib/text-export.ts"],
  },
  {
    what: "the export helpers that save without telling the user",
    pattern: /\bexportCsvArtifact\s*\(|\bexportTextArtifact\s*\(/,
    allowed: ["lib/shared/lib/text-export.ts", "lib/shared/lib/save-export.ts"],
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(svelte|ts)$/.test(name) || /\.test\.ts$/.test(name)) return [];
    return [path];
  });
}

function offenders(pattern: RegExp, allowed: string[]): string[] {
  return sourceFiles(SRC)
    .map((path) => relative(SRC, path))
    .filter((file) => !allowed.includes(file))
    .filter((file) => pattern.test(readFileSync(join(SRC, file), "utf8")));
}

describe("exports save through save-export", () => {
  it.each(SAVE_PATHS)("nothing else saves through $what", ({ pattern, allowed }) => {
    expect(offenders(pattern, allowed)).toEqual([]);
  });

  it("each pattern catches what it is there for", () => {
    const probes: [string, string][] = [
      [
        'import { BaseDirectory as B } from "@tauri-apps/plugin-fs"; writeTextFile(f, t, { baseDir: B.Download });',
        SAVE_PATHS[0].pattern.source,
      ],
      ["const dir = await downloadDir();", SAVE_PATHS[0].pattern.source],
      ['await invoke("save_download", { filename, contents });', SAVE_PATHS[1].pattern.source],
      [
        'a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);',
        SAVE_PATHS[2].pattern.source,
      ],
      ["link.download = name;", SAVE_PATHS[2].pattern.source],
      ["exportTextArtifact({ filename, text });", SAVE_PATHS[3].pattern.source],
    ];
    for (const [code, source] of probes) expect(new RegExp(source).test(code), code).toBe(true);
  });

  it("CSV cells come from the shared csv module", () => {
    const localCells = /function toCsvCell|replace\(\/"\/g, '""'\)|replaceAll\('"', '""'\)/;
    expect(offenders(localCells, ["lib/shared/lib/csv.ts"])).toEqual([]);
  });

  it("list exports name the cluster and the time, so a new file never replaces the last one", () => {
    const fixedName = /filename: "[a-z-]+\.csv"|const filename = "[a-z-]+\.csv"/;
    const tables = sourceFiles(join(SRC, "lib/widgets/datalists/ui"))
      .map((path) => relative(SRC, path))
      .filter((file) => file.endsWith(".svelte"));
    const fixed = tables.filter((file) => fixedName.test(readFileSync(join(SRC, file), "utf8")));
    expect(tables.length).toBeGreaterThan(10);
    expect(fixed).toEqual([]);
  });
});
