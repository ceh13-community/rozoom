import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "$lib/pages/cluster-manager/lib/keyboard-shortcuts";
import { getGotoChords } from "$features/command-palette";
import { CLUSTER_MANAGER_SHORTCUT_ROWS, buildShortcutGroups } from "./keyboard-shortcuts";

describe("Help > Keyboard Shortcuts", () => {
  it("lists the Manage Kubernetes Clusters shortcuts exactly as that page handles them", () => {
    expect(CLUSTER_MANAGER_SHORTCUT_ROWS).toEqual(SHORTCUTS);
  });

  it("lists every go-to chord of the cluster pages", () => {
    const clusterPages = buildShortcutGroups(false).find((g) => g.title === "Cluster pages");
    expect(clusterPages?.rows.filter((row) => row.description.startsWith("Go to"))).toHaveLength(
      getGotoChords().length,
    );
    expect(clusterPages?.rows).toContainEqual({ keys: "g then p", description: "Go to Pods" });
  });

  it("names the platform modifier", () => {
    const palette = (onMac: boolean) =>
      buildShortcutGroups(onMac)
        .flatMap((group) => group.rows)
        .find((row) => row.description === "Command palette")?.keys;
    expect(palette(false)).toBe("Ctrl + K");
    expect(palette(true)).toBe("Cmd + K");
  });
});
