import { noteClusterEvent } from "$shared/lib/action-log";

export interface ClusterEvent<T = unknown> {
  clusterId: string;
  kind: string;
  payload: T;
}

type Listener = (event: ClusterEvent) => void;

export function createEventBus() {
  const listeners = new Set<Listener>();

  return {
    subscribe(fn: Listener) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(event: ClusterEvent) {
      for (const l of listeners) l(event);
    },
    clear() {
      listeners.clear();
    },
  };
}

export const eventBus = createEventBus();

// Every event the open lists receive also tells the action log when a change the user
// made (delete, scale, restart...) reached a list.
eventBus.subscribe(noteClusterEvent);
