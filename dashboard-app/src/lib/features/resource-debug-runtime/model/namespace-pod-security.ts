import { loadNamespacePodSecurityLevels } from "./pod-network-debug";

export type NamespacePodSecurityLevels = Map<string, string> | null;

export type NamespacePodSecurityReader = {
  /** Point the reader at a cluster (null clears) and read its levels; an older read still in flight is dropped. */
  use: (clusterId: string | null) => Promise<void>;
  /** Read again for the current cluster, through the one-minute cache, so a changed label shows up while the page stays open. */
  refresh: () => Promise<void>;
};

/**
 * Keeps the Pod Security enforce levels of the current cluster for a page that stays open.
 * Every read carries a generation; a result that arrives after a newer `use` or `refresh`
 * is ignored, so the levels of a cluster switched away from never land on the namespaces
 * of the next one. `onLevels` receives null while nothing is known for the current cluster.
 */
export function createNamespacePodSecurityReader(
  onLevels: (levels: NamespacePodSecurityLevels) => void,
  load: (clusterId: string) => Promise<NamespacePodSecurityLevels> = loadNamespacePodSecurityLevels,
): NamespacePodSecurityReader {
  let clusterId: string | null = null;
  let generation = 0;

  async function read(): Promise<void> {
    const id = clusterId;
    const started = ++generation;
    if (!id) {
      onLevels(null);
      return;
    }
    const levels = await load(id);
    if (started !== generation) return;
    onLevels(levels);
  }

  return {
    use(next) {
      clusterId = next;
      onLevels(null);
      return read();
    },
    refresh() {
      return read();
    },
  };
}
