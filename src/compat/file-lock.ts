type FileLockOptions = {
  retries: {
    retries: number;
    factor: number;
    minTimeout: number;
    maxTimeout: number;
    randomize?: boolean;
  };
  stale: number;
};

type WithFileLock = <T>(filePath: string, options: FileLockOptions, fn: () => Promise<T>) => Promise<T>;

/** Public runtime export on every supported host. Types were removed after 2026.6.1. */
export const FILE_LOCK_SPECIFIER = "openclaw/plugin-sdk/file-lock";

export async function loadHostFileLock(
  load: () => Promise<{ withFileLock?: WithFileLock }> = async () => {
    const specifier: string = FILE_LOCK_SPECIFIER;
    return import(specifier);
  },
): Promise<WithFileLock> {
  const loaded = await load();
  if (typeof loaded.withFileLock !== "function") {
    throw new Error("openclaw/plugin-sdk/file-lock does not export withFileLock");
  }
  return loaded.withFileLock;
}

export async function withFileLock<T>(filePath: string, options: FileLockOptions, fn: () => Promise<T>): Promise<T> {
  const lock = await loadHostFileLock();
  return lock(filePath, options, fn);
}
