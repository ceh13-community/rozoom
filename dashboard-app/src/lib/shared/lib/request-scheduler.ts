type SchedulerTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  priority: number;
};

export type RequestScheduler = {
  schedule: <T>(run: () => Promise<T>, options?: { priority?: number }) => Promise<T>;
  getActiveCount: () => number;
  getQueuedCount: () => number;
  clearQueue: (reason?: string) => void;
};

export function createRequestScheduler(maxConcurrent = 4): RequestScheduler {
  const limit = Math.max(1, Math.floor(maxConcurrent));
  const queue: SchedulerTask<unknown>[] = [];
  let activeCount = 0;

  const pump = () => {
    if (activeCount >= limit) return;
    const next = queue.shift();
    if (!next) return;
    activeCount += 1;
    void next
      .run()
      .then((value) => {
        next.resolve(value);
      })
      .catch((error: unknown) => {
        next.reject(error);
      })
      .finally(() => {
        activeCount = Math.max(0, activeCount - 1);
        pump();
      });
  };

  return {
    schedule: <T>(run: () => Promise<T>, options?: { priority?: number }) => {
      const priority = Number.isFinite(options?.priority) ? Number(options?.priority) : 0;
      return new Promise<T>((resolve, reject) => {
        const task: SchedulerTask<T> = {
          run,
          resolve,
          reject,
          priority,
        };
        if (queue.length === 0) {
          queue.push(task as SchedulerTask<unknown>);
        } else {
          const insertAt = queue.findIndex((entry) => entry.priority < priority);
          if (insertAt < 0) {
            queue.push(task as SchedulerTask<unknown>);
          } else {
            queue.splice(insertAt, 0, task as SchedulerTask<unknown>);
          }
        }
        pump();
      });
    },
    getActiveCount: () => activeCount,
    getQueuedCount: () => queue.length,
    clearQueue: (reason = "request queue cleared") => {
      if (queue.length === 0) return;
      const pending = queue.splice(0);
      for (const task of pending) {
        task.reject(new Error(reason));
      }
    },
  };
}

export const workloadRequestScheduler = createRequestScheduler(5);
