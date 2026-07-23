type NoValue = ReturnType<() => void>;

export type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (...args: [T] extends [NoValue] ? [] : [value: T]) => void;
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
    resolve: (...args) => resolvePromise(args[0] as T),
    reject: rejectPromise,
  };
}
