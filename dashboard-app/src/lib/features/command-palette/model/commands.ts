import { get } from "svelte/store";
import { goto } from "$app/navigation";
import { clustersList } from "$features/cluster-manager";
import {
  WORKSPACE_WORKLOAD_OPTIONS,
  type WorkspaceWorkloadOption,
} from "$lib/pages/cluster/model/cluster-page-workload-config";
import { GOTO_CHORD_MAP } from "./goto-shortcuts";

export type PaletteCommand = {
  id: string;
  label: string;
  group: string;
  keywords: string[];
  shortcut?: string;
  execute: () => void;
};

/** Build navigation commands for all known workload pages. */
/** Reverse lookup: workload type -> chord key */
const chordByWorkload = Object.fromEntries(
  Object.entries(GOTO_CHORD_MAP).map(([key, workload]) => [workload, `g ${key}`]),
);

export function buildWorkloadCommands(clusterId: string): PaletteCommand[] {
  return WORKSPACE_WORKLOAD_OPTIONS.map((opt: WorkspaceWorkloadOption) => ({
    id: `nav:${opt.value}`,
    label: opt.label,
    group: opt.group ?? "Navigation",
    keywords: [opt.value, opt.label.toLowerCase()],
    shortcut: chordByWorkload[opt.value],
    execute: () => {
      void goto(`/dashboard/clusters/${clusterId}?workload=${opt.value}`);
    },
  }));
}

/** Build commands to switch between clusters. */
export function buildClusterCommands(): PaletteCommand[] {
  const clusters = get(clustersList);
  return clusters.map((cluster) => ({
    id: `cluster:${cluster.uuid}`,
    label: cluster.name,
    group: "Clusters",
    keywords: [cluster.name.toLowerCase(), cluster.uuid],
    execute: () => {
      void goto(`/dashboard/clusters/${cluster.uuid}?workload=overview`);
    },
  }));
}

/** Build static app-level commands. */
export function buildAppCommands(): PaletteCommand[] {
  return [
    {
      id: "app:dashboard",
      label: "Go to Fleet Dashboard",
      group: "App",
      keywords: ["dashboard", "fleet", "home"],
      execute: () => {
        void goto("/dashboard");
      },
    },
    {
      id: "app:cluster-manager",
      label: "Go to Cluster Manager",
      group: "App",
      keywords: ["cluster", "manager", "add", "connect"],
      execute: () => {
        void goto("/cluster-manager");
      },
    },
  ];
}

/** Build the full command list for a given context. */
export function buildAllCommands(clusterId: string | null): PaletteCommand[] {
  const commands: PaletteCommand[] = [...buildAppCommands(), ...buildClusterCommands()];
  if (clusterId) {
    commands.push(...buildWorkloadCommands(clusterId));
  }
  return commands;
}
