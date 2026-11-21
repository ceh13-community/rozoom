import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve("src/lib/widgets/datalists/ui", file), "utf8");

// Lists fed by a watch rebuild a row only when the object changes, so an Age label
// stored on the row froze ("3s" forever on a new pod). Every Age cell reads the shared
// clock through liveAge() (or liveNowMs() for the Nodes "just now" label) instead.
const ageCells: Array<[file: string, pattern: RegExp]> = [
  ["pods-list/data-table.svelte", /\{liveAge\(row\.startedAt, row\.age\)\}/],
  ["deployments-list.svelte", /cell: \(\{ row \}\) => liveAge\(row\.original\.createdAt/],
  ["daemon-sets-list.svelte", /cell: \(\{ row \}\) => liveAge\(row\.original\.createdAt/],
  ["stateful-sets-list.svelte", /cell: \(\{ row \}\) => liveAge\(row\.original\.createdAt/],
  ["replica-sets-list.svelte", /cell: \(\{ row \}\) => liveAge\(row\.original\.createdAt/],
  ["jobs-list.svelte", /cell: \(\{ row \}\) => liveAge\(row\.original\.createdAt/],
  ["cron-jobs-list.svelte", /cell: \(\{ row \}\) => liveAge\(row\.original\.createdAt/],
  ["configuration-list.svelte", /\{liveAge\(row\.createdAt, row\.age\)\}/],
  ["network/network-list.svelte", /\{liveAge\(row\.createdAt, row\.age\)\}/],
  ["custom-resources/custom-resources-list.svelte", /\{liveAge\(row\.createdAt, row\.age\)\}/],
  [
    "custom-resources/custom-resources-list.svelte",
    /\{liveAge\(instance\.createdAt, instance\.age\)\}/,
  ],
  ["nodes-list/columns.ts", /liveNowMs\(\) - row\.original\.age\.getTime\(\)/],
];

describe("live Age cells", () => {
  it.each(ageCells)("%s counts Age from the shared clock", (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });

  it.each([
    "deployments-list.svelte",
    "daemon-sets-list.svelte",
    "stateful-sets-list.svelte",
    "replica-sets-list.svelte",
    "jobs-list.svelte",
    "cron-jobs-list.svelte",
  ])("%s sorts Age by the creation time, not by the frozen label", (file) => {
    expect(read(file)).toContain("accessorFn: (row) => ageSortKey(row.createdAt),");
  });
});
