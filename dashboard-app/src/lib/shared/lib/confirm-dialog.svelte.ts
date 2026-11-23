// In-app replacement for the system confirm. The Tauri dialog opened a window of its own,
// outside the app's look and focus, and on WebKitGTK it could sit behind the app window.
// One host (ConfirmDialogHost in the root layout) renders the open request; the requests
// form a queue, so two confirms raised at once are answered one after the other.

export type ConfirmRequest = {
  title: string;
  message: string;
};

type PendingConfirm = ConfirmRequest & { resolve: (confirmed: boolean) => void };

let queue = $state<PendingConfirm[]>([]);
let hosts = 0;

export const confirmDialog = {
  /** The request on screen, or null when nothing is asked. */
  get current(): ConfirmRequest | null {
    return queue[0] ?? null;
  },
  /** Requests waiting behind the one on screen. */
  get queued(): number {
    return Math.max(0, queue.length - 1);
  },
};

/** True when a host can show the dialog in this window. */
export function hasConfirmHost(): boolean {
  return hosts > 0;
}

/**
 * Called by a host on mount; returns the unregister function for its unmount. When the last
 * host leaves, every pending request is answered No, so nothing waits forever on a dialog
 * that cannot be shown.
 */
export function registerConfirmHost(): () => void {
  hosts += 1;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    hosts -= 1;
    if (hosts === 0) declineAllConfirms();
  };
}

/** Queues a question for the host. Resolves true only on an explicit confirm. */
export function requestConfirm(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...request, resolve }];
  });
}

/** Answers the request on screen; the next queued one takes its place. */
export function settleConfirm(confirmed: boolean) {
  const current = queue.at(0);
  if (!current) return;
  queue = queue.slice(1);
  current.resolve(confirmed);
}

function declineAllConfirms() {
  const pending = queue;
  queue = [];
  for (const request of pending) request.resolve(false);
}
