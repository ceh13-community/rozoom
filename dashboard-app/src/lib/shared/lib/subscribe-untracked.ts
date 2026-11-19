import { untrack } from "svelte";
import type { Readable } from "svelte/store";

/**
 * Subscribes to a store and runs the handler outside any reactive context.
 *
 * A store calls its subscribers synchronously from set/update, so the handler runs inside
 * whatever effect made the update. Every $state the handler reads then becomes a dependency
 * of that effect, and if the handler also writes it, the effect reruns on its own write until
 * Svelte stops with effect_update_depth_exceeded. Untracked, the handler's reads belong to no
 * effect. Use it for subscribers that read component state, such as a snapshot rebuilt from
 * the previous one.
 */
export function subscribeUntracked<T>(store: Readable<T>, handler: (value: T) => void): () => void {
  return store.subscribe((value) => {
    untrack(() => {
      handler(value);
    });
  });
}
