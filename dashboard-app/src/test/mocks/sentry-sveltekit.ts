type HandleInput = {
  event: unknown;
  resolve: (event: unknown) => Promise<unknown>;
};

type ErrorHandler = (input: unknown) => unknown;

export function init() {}

export function captureException() {}

export function handleErrorWithSentry(handler?: ErrorHandler) {
  return (input: unknown) => handler?.(input);
}

export function sentryHandle({ event, resolve }: HandleInput) {
  return resolve(event);
}
