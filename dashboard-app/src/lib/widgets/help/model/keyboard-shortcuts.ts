import { getGotoChords } from "$features/command-palette";

export type ShortcutRow = { keys: string; description: string };
export type ShortcutGroup = { title: string; rows: ShortcutRow[] };

/**
 * Shortcuts of the Manage Kubernetes Clusters page. They are handled by that page; the test
 * keeps this list equal to the handler's own list.
 */
export const CLUSTER_MANAGER_SHORTCUT_ROWS: ShortcutRow[] = [
  { keys: "/", description: "Focus search" },
  { keys: "p", description: "Filter env: prod" },
  { keys: "s", description: "Filter env: stage" },
  { keys: "d", description: "Filter env: dev" },
  { keys: "Esc", description: "Clear search / filter" },
  { keys: "?", description: "Show this help" },
];

/** Every keyboard shortcut the app handles, grouped by where it works. */
export function buildShortcutGroups(onMac: boolean): ShortcutGroup[] {
  const mod = onMac ? "Cmd" : "Ctrl";
  return [
    {
      title: "Everywhere",
      rows: [{ keys: "Esc", description: "Close the open panel or dialog" }],
    },
    {
      title: "Cluster pages",
      rows: [
        { keys: `${mod} + K`, description: "Command palette" },
        { keys: "/", description: "Focus the list search" },
        ...getGotoChords().map(({ chord, label }) => ({
          keys: chord.split(" ").join(" then "),
          description: `Go to ${label}`,
        })),
      ],
    },
    { title: "Manage Kubernetes Clusters", rows: CLUSTER_MANAGER_SHORTCUT_ROWS },
  ];
}
