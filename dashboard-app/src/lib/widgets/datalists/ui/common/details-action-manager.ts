import { createAbortManager } from "$shared/lib/abort-manager";

type DetailsActionHandler<T> = (ctx: {
  signal: AbortSignal;
  isLatest: () => boolean;
}) => Promise<T>;

export function createDetailsActionManager() {
  const abortManager = createAbortManager();

  async function runLatest<T>(
    key: string,
    handler: DetailsActionHandler<T>,
  ): Promise<T | undefined> {
    const signal = abortManager.nextSignal(key);
    const isLatest = () => abortManager.isLatest(key, signal);
    return await handler({ signal, isLatest });
  }

  return {
    runLatest,
    abort: abortManager.abort,
    abortAll: abortManager.abortAll,
  };
}
