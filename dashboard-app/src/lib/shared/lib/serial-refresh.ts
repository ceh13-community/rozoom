export type RefreshOptions = {
  force?: boolean;
};

export function createSerialRefresh<TOptions extends RefreshOptions = RefreshOptions>(
  run: (options?: TOptions) => Promise<void>,
): {
  trigger: (options?: TOptions) => Promise<void>;
} {
  let inFlight = false;
  let pendingForce = false;

  async function trigger(options?: TOptions): Promise<void> {
    if (inFlight) {
      pendingForce = pendingForce || Boolean(options?.force);
      return;
    }

    inFlight = true;
    try {
      await run(options);
    } finally {
      inFlight = false;
      if (pendingForce) {
        const force = pendingForce;
        pendingForce = false;
        void trigger({ force } as TOptions);
      }
    }
  }

  return { trigger };
}
