export type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export function createDeferred<T = void>(): Deferred<T> {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => {
    throw new Error("Deferred promise was not initialized");
  };
  let rejectPromise: (reason?: unknown) => void = () => {
    throw new Error("Deferred promise was not initialized");
  };
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value: T) => resolvePromise(value),
    reject: rejectPromise,
  };
}
